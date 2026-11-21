import { timingSafeEqual } from 'node:crypto';
import { assistFileLimit } from '../authoring/assist-exchange';
import { decodeJson } from '../authoring/decode-json';
import type { CompanionGeneration } from './generation';
import type { issueCompanionTicket } from './issue-ticket';
import type { PricePolicy } from './price-policy';
import type { TicketRequest } from './signed-ticket';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const maximumTicket = 2_048;
const maximumEnvelope = assistFileLimit + maximumTicket + 1_024;
const textEncoder = new TextEncoder();

export type VerifiedCompanionSession = {
  subjectBinding: string;
  csrfToken: string;
  serviceEnabled: boolean;
  disabledReason: string | null;
  modelLabel: string;
  pricePolicy: PricePolicy | null;
  subjectAllowance: { remainingMicrousd: string; resetsAt: string; generationStartsPerMinute: number; concurrentLimit: number };
  globalCapacityAvailable: boolean;
  sessionIdleExpiresAt: string;
  sessionAbsoluteExpiresAt: string;
};

type Options = {
  origin: string;
  authenticate: (request: Request) => Promise<VerifiedCompanionSession | null>;
  logout: (request: Request, session: VerifiedCompanionSession) => Promise<void>;
  issue: (request: TicketRequest, subject: string, now: number) => ReturnType<typeof issueCompanionTicket>;
  generation: Pick<CompanionGeneration, 'generate' | 'readRequestStatus'>;
  now?: () => number;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

function problem(status: number, code: string, message: string, serverTime: string, detail?: object) {
  return Response.json({ code, message, retryable: false, serverTime, ...detail }, { status,
    headers: { ...noStore, 'Content-Type': 'application/problem+json' } });
}

const rejection = {
  INVALID_REQUEST: [400, 'MALFORMED_REQUEST', 'The request did not match the Meridian contract.'],
  REQUEST_CLOCK_SKEW: [400, 'REQUEST_CLOCK_SKEW', 'The request clock is ahead of the service.'],
  REQUEST_EXPIRED: [410, 'REQUEST_EXPIRED', 'Export a fresh request from Meridian.'],
  TICKET_EXPIRED: [410, 'TICKET_EXPIRED', 'The reviewed ticket has expired.'],
  TICKET_INVALID: [403, 'TICKET_INVALID', 'The ticket could not be verified.'],
  IDEMPOTENCY_CONFLICT: [409, 'IDEMPOTENCY_CONFLICT', 'Review the matching request and its idempotency key.'],
  PRICE_POLICY_CHANGED: [409, 'PRICE_POLICY_CHANGED', 'Review the current charge ceiling before trying again.'],
  REQUEST_ALREADY_STARTED: [409, 'REQUEST_ALREADY_STARTED', 'Read the status of the existing request.'],
  FRESH_REQUEST_REQUIRED: [409, 'FRESH_REQUEST_REQUIRED', 'Export a fresh request from Meridian.'],
  RATE_LIMITED: [429, 'RATE_LIMITED', 'The current admission limit has been reached.'],
  BUDGET_EXHAUSTED: [429, 'BUDGET_EXHAUSTED', 'The available spending allowance has been reached.'],
} as const;

class RequestTooLarge extends Error {}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(request: Request, limit: number) {
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json' || !request.body) {
    throw new Error('Expected a JSON body.');
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && /^(0|[1-9][0-9]*)$/.test(length) && Number(length) > limit) throw new RequestTooLarge();
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new RequestTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return decodeJson(text + decoder.decode(), 6_002, 'number', undefined, 9);
  } finally { reader.releaseLock(); }
}

function ticketRequest(value: unknown): TicketRequest | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 5) return;
  const { requestId, requestHash, acknowledgeBillableRequest, pricePolicyVersion, acknowledgedMaxChargeMicrousd } = value;
  if (typeof requestId !== 'string' || typeof requestHash !== 'string' || acknowledgeBillableRequest !== true
    || typeof pricePolicyVersion !== 'string' || typeof acknowledgedMaxChargeMicrousd !== 'string') return;
  return { requestId, requestHash, acknowledgeBillableRequest, pricePolicyVersion, acknowledgedMaxChargeMicrousd };
}

function verifiesCsrf(expected: string, actual: string | null) {
  if (!actual || actual.length < 32 || actual.length > 128) return false;
  const a = textEncoder.encode(actual);
  const b = textEncoder.encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionActive(session: VerifiedCompanionSession, now: number) {
  return Date.parse(session.sessionIdleExpiresAt) > now && Date.parse(session.sessionAbsoluteExpiresAt) > now;
}

function publicSession(session: VerifiedCompanionSession) {
  const { csrfToken, serviceEnabled, disabledReason, modelLabel, pricePolicy, subjectAllowance,
    globalCapacityAvailable, sessionIdleExpiresAt, sessionAbsoluteExpiresAt } = session;
  const { remainingMicrousd, resetsAt, generationStartsPerMinute, concurrentLimit } = subjectAllowance;
  const pricing = pricePolicy && {
    version: pricePolicy.version, currency: pricePolicy.currency, unit: pricePolicy.unit,
    maxInputTokens: pricePolicy.maxInputTokens, maxOutputTokens: pricePolicy.maxOutputTokens,
    inputMicrousdPerMillionTokens: pricePolicy.inputMicrousdPerMillionTokens,
    outputMicrousdPerMillionTokens: pricePolicy.outputMicrousdPerMillionTokens,
    fixedUpperBoundMicrousd: pricePolicy.fixedUpperBoundMicrousd, maxChargeMicrousd: pricePolicy.maxChargeMicrousd,
    displayLabel: pricePolicy.displayLabel,
  };
  return { csrfToken, serviceEnabled, disabledReason, modelLabel, pricePolicy: pricing,
    subjectAllowance: { remainingMicrousd, resetsAt, generationStartsPerMinute, concurrentLimit },
    globalCapacityAvailable, sessionIdleExpiresAt, sessionAbsoluteExpiresAt };
}

/** Same-origin companion API. Session verification belongs to the independently configured identity service. */
export function createLocalCompanionApi({ origin, authenticate, logout, issue, generation, now = Date.now }: Options) {
  const canonical = new URL(origin);
  if (canonical.origin !== origin || canonical.protocol !== 'https:') throw new Error('Configure an exact HTTPS companion origin.');

  return async (request: Request) => {
    const observedAt = now();
    const serverTime = new Date(observedAt).toISOString();
    const url = new URL(request.url);
    const path = url.pathname;
    const read = request.method === 'GET';
    const write = request.method === 'POST';
    const statusRequestId = read ? /^\/v1\/proposals\/([^/]+)$/.exec(path)?.[1] : undefined;
    const available = read && (path === '/v1/session' || !!statusRequestId)
      || write && (path === '/v1/tickets' || path === '/v1/proposals' || path === '/v1/logout');
    if (url.origin !== origin || url.search || !available) return problem(404, 'REQUEST_NOT_FOUND', 'This request is unavailable.', serverTime);

    const rejected = (code: keyof typeof rejection) => {
      const [status, kind, message] = rejection[code];
      return problem(status, kind, message, serverTime);
    };
    const unauthorized = () => problem(401, 'AUTH_REQUIRED', 'Sign in to the companion to continue.', serverTime);
    const malformed = () => rejected('INVALID_REQUEST');
    try {
      const verified = await authenticate(request);
      if (!verified || !sessionActive(verified, observedAt)) return unauthorized();
      const { subjectBinding } = verified;
      if (write && (request.headers.get('Origin') !== origin || !verifiesCsrf(verified.csrfToken, request.headers.get('X-CSRF-Token')))) {
        return problem(403, 'CSRF_FAILED', 'The request did not match this companion session.', serverTime);
      }
      if (read && path === '/v1/session') return json({ authenticated: true, serverTime, ...publicSession(verified) });
      if (statusRequestId) {
        const result = await generation.readRequestStatus(subjectBinding, statusRequestId);
        return result.status === 200 ? json(result.body) : Response.json(result.body, {
          status: result.status, headers: { ...noStore, 'Content-Type': 'application/problem+json' },
        });
      }
      if (path !== '/v1/logout' && !verified.serviceEnabled) return problem(503, 'SERVICE_DISABLED', 'The companion is unavailable for new requests.', serverTime);
      let value: unknown;
      try { value = await readJson(request, path === '/v1/proposals' ? maximumEnvelope : 4_096); }
      catch (error) { return error instanceof RequestTooLarge
        ? problem(413, 'REQUEST_TOO_LARGE', 'Choose a smaller Meridian request.', serverTime) : malformed(); }
      if (!sessionActive(verified, now())) return unauthorized();
      if (path === '/v1/logout') {
        if (!isRecord(value) || Object.keys(value).length) return malformed();
        await logout(request, verified);
        return new Response(null, { status: 204, headers: { ...noStore,
          'Set-Cookie': '__Host-meridian-assist=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax' } });
      }
      if (path === '/v1/tickets') {
        const ticket = ticketRequest(value);
        if (!ticket) return malformed();
        const issued = await issue(ticket, subjectBinding, now());
        if (issued.code !== 'ISSUED' && issued.code !== 'EXISTING') return rejected(issued.code);
        const { claims } = issued;
        return json({ ticket: issued.ticket, ticketId: claims.jti, requestId: claims.requestId, requestHash: claims.requestHash,
          issuedAt: new Date(claims.iat * 1_000).toISOString(), expiresAt: new Date(claims.exp * 1_000).toISOString(),
          pricePolicyVersion: claims.pricePolicyVersion, maxChargeMicrousd: claims.maxChargeMicrousd }, issued.code === 'ISSUED' ? 201 : 200);
      }

      const idempotency = request.headers.get('Idempotency-Key');
      if (!idempotency || !isRecord(value) || Object.keys(value).length !== 2 || typeof value.ticket !== 'string'
        || value.ticket.length < 16 || value.ticket.length > maximumTicket || !isRecord(value.request)) return malformed();
      const bytes = textEncoder.encode(JSON.stringify(value.request));
      if (bytes.byteLength > assistFileLimit) return problem(413, 'REQUEST_TOO_LARGE', 'Choose a smaller Meridian request.', serverTime);
      const outcome = await generation.generate(subjectBinding, value.ticket, idempotency, bytes);
      if (outcome.code === 'RESULT_UNAVAILABLE') return problem(503, 'LEDGER_UNAVAILABLE', 'The saved proposal could not be read.', serverTime);
      if (outcome.code === 'STATUS' || outcome.code === 'RESULT_EXPIRED') {
        const result = await generation.readRequestStatus(subjectBinding, idempotency);
        if (result.status !== 200) return Response.json(result.body, {
          status: result.status, headers: { ...noStore, 'Content-Type': 'application/problem+json' },
        });
        const { state, cost } = result.body;
        if (state === 'uncertain') return problem(504, 'PROVIDER_OUTCOME_UNKNOWN', 'The provider outcome is unknown. The reservation is retained.', serverTime, { state, cost });
        if (state === 'failed') return problem(502, 'PROVIDER_FAILED', 'The provider did not return an accepted proposal.', serverTime, { state, cost });
        return json(result.body, state === 'running' ? 202 : 200);
      }
      if (outcome.code in rejection) return rejected(outcome.code as keyof typeof rejection);
      return problem(503, 'LEDGER_UNAVAILABLE', 'The companion status could not be read.', serverTime);
    } catch {
      return problem(503, 'LEDGER_UNAVAILABLE', 'The companion could not complete this request.', serverTime);
    }
  };
}
