import { assistFileLimit } from '../lib/authoring/assist-exchange';
import { requestIdPattern } from '../lib/authoring/assist-request-id';
import { validateCompanionOperations } from '../lib/companion/operations';
import { parseCompanionRequest } from '../lib/companion/request';

export type ReviewedFile = Awaited<ReturnType<typeof parseCompanionRequest>>;
export type Session = {
  csrfToken: string;
  enabled: boolean;
  model: string;
  policy: { version: string; maximum: string } | null;
  remaining: string;
  globalCapacity: boolean;
};

const money = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(value);
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid companion response.');
  return value as Record<string, unknown>;
};

export function usd(microusd: string) {
  const value = BigInt(microusd);
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0{0,4}$/, '');
  return `$${value / 1_000_000n}.${fraction}`;
}

export async function readFile(file: File) {
  if (file.size > assistFileLimit) throw new Error('Choose a Meridian request of 128 KiB or less.');
  return parseCompanionRequest(new Uint8Array(await file.arrayBuffer()));
}

async function send(path: string, options?: RequestInit) {
  return fetch(path, { ...options, mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
}

function post(path: string, session: Session, body: object, signal?: AbortSignal, requestId?: string) {
  return send(path, {
    method: 'POST', signal, body: JSON.stringify(body), headers: {
      'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken,
      ...(requestId ? { 'Idempotency-Key': requestId } : {}),
    },
  });
}

export async function readSession(): Promise<Session | null> {
  const response = await send('/v1/session', { signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('The companion session is unavailable.');
  const value = record(await response.json());
  const allowance = record(value.subjectAllowance);
  const price = value.pricePolicy === null ? null : record(value.pricePolicy);
  if (value.authenticated !== true || typeof value.csrfToken !== 'string' || value.csrfToken.length < 32 ||
      value.csrfToken.length > 128 || typeof value.serviceEnabled !== 'boolean' || typeof value.modelLabel !== 'string' ||
      value.modelLabel.length > 120 || !money(allowance.remainingMicrousd) || typeof value.globalCapacityAvailable !== 'boolean') {
    throw new Error('The companion session response is invalid.');
  }
  let policy: Session['policy'] = null;
  if (price && typeof price.version === 'string' && price.currency === 'USD' && price.unit === 'microdollar' && money(price.maxChargeMicrousd)) {
    policy = { version: price.version, maximum: price.maxChargeMicrousd };
  }
  if (value.serviceEnabled && !policy) throw new Error('The companion price policy is unavailable.');
  return {
    csrfToken: value.csrfToken, enabled: value.serviceEnabled, model: value.modelLabel,
    policy, remaining: allowance.remainingMicrousd, globalCapacity: value.globalCapacityAvailable,
  };
}

export async function requestProposal(session: Session, file: ReviewedFile, signal: AbortSignal) {
  const { request, requestHash } = file;
  const { policy } = session;
  if (!policy) throw new Error('The companion price policy is unavailable.');
  const issued = await post('/v1/tickets', session, {
    requestId: request.requestId, requestHash, acknowledgeBillableRequest: true,
    pricePolicyVersion: policy.version, acknowledgedMaxChargeMicrousd: policy.maximum,
  }, signal);
  if (!issued.ok) return readOutcome(issued, file);
  const ticket = record(await issued.json());
  if (ticket.requestId !== request.requestId || ticket.requestHash !== requestHash ||
      ticket.pricePolicyVersion !== policy.version || ticket.maxChargeMicrousd !== policy.maximum ||
      typeof ticket.ticket !== 'string' || ticket.ticket.length < 16 || ticket.ticket.length > 4096 ||
      typeof ticket.expiresAt !== 'string' || !Number.isFinite(Date.parse(ticket.expiresAt))) {
    throw new Error('The ticket does not match the reviewed request and price.');
  }
  signal.throwIfAborted();
  return readOutcome(await post('/v1/proposals', session, { ticket: ticket.ticket, request }, signal, request.requestId), file);
}

export async function checkStatus(file: ReviewedFile, signal: AbortSignal) {
  if (!requestIdPattern.test(file.request.requestId)) throw new Error('Invalid request identity.');
  return readOutcome(await send(`/v1/proposals/${encodeURIComponent(file.request.requestId)}`, { signal }), file);
}

export async function signOut(session: Session) {
  const response = await post('/v1/logout', session, {}, AbortSignal.timeout(10_000));
  if (response.status !== 204 && response.status !== 401) throw new Error('The companion could not end this session.');
}

export type Outcome = { message: string; proposal?: string; signedOut?: boolean };

const states: Record<string, string> = {
  issued: 'A ticket was issued. No proposal is available.',
  running: 'Generation is still running. Check status to recover its result.',
  succeeded: 'The proposal is ready to download and review in Meridian.',
  rejected: 'The companion rejected the request.',
  failed: 'The provider did not return an accepted proposal.',
  uncertain: 'The provider outcome is unknown. The reservation is retained. Check status before considering a new request.',
  expired: 'The ticket expired. Export a fresh request from Meridian for a new generation.',
};

async function readOutcome(response: Response, file: ReviewedFile): Promise<Outcome> {
  const value = record(await response.json());
  let message = typeof value.state === 'string' && Object.hasOwn(states, value.state) ? states[value.state] : undefined;
  if (!response.ok && value.state !== 'uncertain' && typeof value.message === 'string') message = value.message.slice(0, 500);
  if (response.ok && value.state === 'succeeded' && value.resultAvailable !== true) message = 'The proposal download has expired.';
  if (!message) throw new Error('The companion returned an unknown proposal status.');
  if (value.cost) {
    const cost = record(value.cost);
    if (cost.currency === 'USD' && cost.unit === 'microdollar') {
      if (cost.costStatus === 'settled_known' && money(cost.settledMicrousd)) message += ` Charged ${usd(cost.settledMicrousd)} USD.`;
      if ((cost.costStatus === 'reserved' || cost.costStatus === 'reserved_unknown') && money(cost.reservedMicrousd)) {
        message += ` Reserved ${usd(cost.reservedMicrousd)} USD.`;
      }
    }
  }
  if (!response.ok || value.state !== 'succeeded' || value.resultAvailable !== true) {
    return { message, signedOut: response.status === 401 };
  }
  const { request, requestHash } = file;
  if (value.requestId !== request.requestId || value.requestHash !== requestHash) throw new Error('The result is for a different request.');
  const data = record(value.proposal);
  const anchor = record(data.baseToken);
  if (data.schema !== 'meridian-proposal/v1' || data.documentKind !== 'mermaid' || data.origin !== 'ai' ||
      typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) ||
      data.requestId !== request.requestId || data.requestHash !== requestHash ||
      Object.entries(request.baseToken).some(([key, expected]) => anchor[key] !== expected)) {
    throw new Error('The proposal does not match the original request.');
  }
  const operations = validateCompanionOperations(JSON.stringify(data.operations), request);
  const proposal = JSON.stringify({
    schema: data.schema, documentKind: data.documentKind, origin: data.origin, id: data.id,
    requestId: request.requestId, requestHash, baseToken: request.baseToken, operations,
  });
  if (new TextEncoder().encode(proposal).byteLength > assistFileLimit) throw new Error('The proposal exceeded its file limit.');
  return { message, proposal };
}
