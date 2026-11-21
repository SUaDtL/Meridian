import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CompanionGeneration } from './generation';
import { issueCompanionTicket } from './issue-ticket';
import { createLocalCompanionApi } from './local-api';
import type { PricePolicy, ProviderUsage } from './price-policy';
import { parseCompanionRequest } from './request';

const sqlite = await import('node:sqlite').catch(error => {
  if (error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE') return undefined;
  throw error;
});
const Ledger = sqlite ? (await import('./serial-admission')).CompanionAdmissionLedger : undefined;
const initialTime = Date.parse('2026-11-20T07:00:00Z');
const subject = 'a'.repeat(64);
const wrongSubject = 'b'.repeat(64);
const encoder = new TextEncoder();
const policy: PricePolicy = {
  version: 'local-test.v1', currency: 'USD', unit: 'microdollar', maxInputTokens: 10, maxOutputTokens: 12,
  inputMicrousdPerMillionTokens: '1000000', outputMicrousdPerMillionTokens: '2000000', fixedUpperBoundMicrousd: '4',
  maxChargeMicrousd: '38', displayLabel: 'Local test',
};
const usage: ProviderUsage = { inputTokens: 2, outputTokens: 3, overheadMicrousd: '1' };
const label = 'Provider stub returned this system';
const operations = JSON.stringify([{ op: 'addNode', ref: 'new:example', label, shape: 'rect', parentGroupId: null }]);
const validOutcome = { kind: 'completed' as const, operations, usage };
type Provider = ConstructorParameters<typeof CompanionGeneration>[4];

function requestAt(index = 1, time = initialTime) {
  const timestamp = time.toString(16).padStart(12, '0');
  return {
    schema: 'meridian/assist-request/v1',
    requestId: `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-${index.toString(16).padStart(12, '0')}`,
    documentKind: 'mermaid',
    baseToken: {
      projectId: '11111111-1111-4111-8111-111111111111', revision: 1,
      contentHash: 'e'.repeat(64), stateDigest: 'f'.repeat(64),
    },
    instruction: 'Prompt remains in memory only',
    scope: { readContextIds: [], writableElementIds: [], attachmentPointIds: [] },
    graph: { nodes: [], edges: [], groups: [] },
    allowedOperations: ['addNode'],
  };
}

async function setup(provider: Provider, filename = ':memory:') {
  const ledger = new Ledger!(filename, { pricePolicy: policy, dailySubjectMicrousd: 38n, dailyGlobalMicrousd: 38n });
  const signing = {
    id: 'local',
    key: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']),
  };
  const keys = new Map([[signing.id, signing.key]]);
  const resultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  let now = initialTime;
  const service = new CompanionGeneration(ledger, keys, resultKey, policy, provider, () => now);

  async function issue(request = requestAt(), owner = subject) {
    const bytes = encoder.encode(JSON.stringify(request));
    const { requestHash } = await parseCompanionRequest(bytes);
    const issued = await issueCompanionTicket({
      requestId: request.requestId, requestHash, acknowledgeBillableRequest: true, pricePolicyVersion: policy.version,
      acknowledgedMaxChargeMicrousd: policy.maxChargeMicrousd,
    }, owner, signing, keys, policy, ledger, now);
    if (issued.code !== 'ISSUED') throw new Error(`Expected issuance, received ${issued.code}.`);
    const generate = (body = bytes, id = request.requestId, caller = owner) => service.generate(caller, issued.ticket, id, body);
    return { bytes, requestHash, issued, generate, requestId: request.requestId };
  }

  const issueFromApi = (request: Parameters<typeof issueCompanionTicket>[0], owner: string, time: number) =>
    issueCompanionTicket(request, owner, signing, keys, policy, ledger, time);
  return { ledger, keys, resultKey, service, issue, issueFromApi, now: () => now,
    advance: (ms: number) => { now = initialTime + ms; } };
}

function apiSession(subjectBinding: string, csrfToken: string, serviceEnabled = true) {
  return { subjectBinding, csrfToken, serviceEnabled, disabledReason: null, modelLabel: 'Local provider fixture',
    pricePolicy: policy, subjectAllowance: { remainingMicrousd: '38', resetsAt: '2026-11-21T00:00:00Z',
      generationStartsPerMinute: 5, concurrentLimit: 2 }, globalCapacityAvailable: true,
    sessionIdleExpiresAt: '2026-11-20T08:00:00Z', sessionAbsoluteExpiresAt: '2026-11-20T15:00:00Z',
  };
}

describe.skipIf(!sqlite)('local companion generation with a provider stub', () => {
  it('serves the local API with exact origin, session, CSRF, body and idempotency boundaries', async () => {
    const origin = 'https://companion.example.invalid';
    const csrf = 'c'.repeat(48);
    let authenticated = true;
    let enabled = true;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let release!: (outcome: typeof validOutcome) => void;
    const result = new Promise<typeof validOutcome>(resolve => { release = resolve; });
    const provider = vi.fn<Provider>(async () => { started(); return result; });
    const env = await setup(provider);
    const api = createLocalCompanionApi({ origin, generation: env.service, issue: env.issueFromApi, now: env.now,
      async authenticate(request) {
        const cookie = request.headers.get('Cookie');
        if (!authenticated || (cookie !== '__Host-meridian-assist=owner' && cookie !== '__Host-meridian-assist=other')) return null;
        const session = apiSession(cookie.endsWith('owner') ? subject : wrongSubject, csrf, enabled);
        return { ...session, pricePolicy: { ...session.pricePolicy, serverCredential: 'fixture-server-credential' },
          subjectAllowance: { ...session.subjectAllowance, privateState: 'fixture-private-state' },
          identityCredential: 'fixture-identity-credential',
        };
      },
      async logout() { authenticated = false; },
    });
    function read(path: string, owner = 'owner') {
      return api(new Request(origin + path, { headers: { Cookie: '__Host-meridian-assist=' + owner } }));
    }
    function send(path: string, body: string, headers: Record<string, string> = {},
      sourceOrigin: string | null = origin, signal?: AbortSignal) {
      return api(new Request(origin + path, { method: 'POST', body, signal, headers: {
        ...(sourceOrigin ? { Origin: sourceOrigin } : {}), Cookie: '__Host-meridian-assist=owner',
        'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers,
      } }));
    }
    try {
      expect((await api(new Request(origin + '/v1/session'))).status).toBe(401);
      const disclosure = await read('/v1/session');
      expect(disclosure.headers.get('Cache-Control')).toBe('no-store');
      expect(disclosure.headers.get('Access-Control-Allow-Origin')).toBeNull();
      const publicFields = await disclosure.text();
      expect(JSON.parse(publicFields)).toMatchObject({ authenticated: true, csrfToken: csrf, pricePolicy: policy });
      expect(publicFields).not.toMatch(/subjectBinding|fixture-(?:server|private|identity)/);
      const request = requestAt();
      const { requestHash } = await parseCompanionRequest(encoder.encode(JSON.stringify(request)));
      const ticketBody = JSON.stringify({ requestId: request.requestId, requestHash, acknowledgeBillableRequest: true,
        pricePolicyVersion: policy.version, acknowledgedMaxChargeMicrousd: policy.maxChargeMicrousd });
      for (const rejected of [
        await send('/v1/tickets', ticketBody, {}, null),
        await send('/v1/tickets', ticketBody, {}, origin + '.other'),
        await send('/v1/tickets', ticketBody, { 'X-CSRF-Token': 'd'.repeat(48) }),
      ]) expect(rejected.status).toBe(403);
      expect(await (await read(`/v1/proposals/${request.requestId}`)).json()).toMatchObject({ code: 'REQUEST_NOT_FOUND' });
      const duplicateKey = ticketBody.replace('{', '{"requestId":"duplicate",');
      expect((await send('/v1/tickets', duplicateKey)).status).toBe(400);
      expect((await send('/v1/tickets', ticketBody, { 'Content-Type': 'text/plain' })).status).toBe(400);
      const oversized = await send('/v1/tickets', ' '.repeat(5_000), { 'Content-Length': '1' });
      expect(oversized.status).toBe(413);
      expect(oversized.headers.get('Content-Type')).toBe('application/problem+json');
      const issued = await send('/v1/tickets', ticketBody);
      expect(issued.status).toBe(201);
      const issuedBody = await issued.json();
      const repeated = await send('/v1/tickets', ticketBody);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual(issuedBody);
      expect((await send('/v1/tickets', ticketBody.replace(requestHash, 'f'.repeat(64)))).status).toBe(409);
      expect(provider).not.toHaveBeenCalled();
      const envelope = JSON.stringify({ ticket: issuedBody.ticket, request });
      const path = `/v1/proposals/${request.requestId}`;
      const headers = { 'Idempotency-Key': request.requestId };
      expect((await send('/v1/proposals', envelope)).status).toBe(400);
      expect((await send('/v1/proposals', envelope, { 'Idempotency-Key': requestAt(2).requestId })).status).toBe(409);
      const client = new AbortController();
      const first = send('/v1/proposals', envelope, headers, origin, client.signal);
      await ready;
      client.abort();
      const duplicate = await send('/v1/proposals', envelope, headers);
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({ state: 'running', resultAvailable: false, cost: { reservedMicrousd: '38' } });
      expect(await (await read(path, 'other')).json()).toEqual(await (await read(`/v1/proposals/${requestAt(2).requestId}`)).json());
      release(validOutcome);
      const complete = await first;
      expect(complete.status).toBe(200);
      const published = await complete.json();
      expect(published).toMatchObject({ requestId: request.requestId, state: 'succeeded', resultAvailable: true });
      expect(await (await read(path)).json()).toEqual(published);
      enabled = false;
      expect((await send('/v1/tickets', ticketBody)).status).toBe(503);
      expect((await read(path)).status).toBe(200);
      env.advance(15 * 60_000);
      const expired = await read(path);
      expect(expired.status).toBe(410);
      expect(await expired.json()).toMatchObject({ code: 'RESULT_EXPIRED', cost: { settledMicrousd: '9' } });
      const signedOut = await send('/v1/logout', '{}');
      expect(signedOut.status).toBe(204);
      expect(signedOut.headers.get('Set-Cookie')).toMatch(/Max-Age=0.*Path=\/.*Secure.*HttpOnly.*SameSite=Lax/);
      expect((await read(path)).status).toBe(401);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { release(validOutcome); env.ledger.close(); }
  });

  it('reports an uncertain provider result through the API without retrying or releasing cost', async () => {
    const origin = 'https://companion.example.invalid';
    const csrf = 'c'.repeat(48);
    const provider = vi.fn<Provider>(async () => { throw new Error('private-provider-fixture'); });
    const env = await setup(provider);
    const api = createLocalCompanionApi({ origin, generation: env.service, issue: env.issueFromApi, now: env.now,
      async authenticate() { return apiSession(subject, csrf); }, async logout() {},
    });
    try {
      const request = requestAt();
      const { issued } = await env.issue(request);
      const send = () => api(new Request(origin + '/v1/proposals', { method: 'POST',
        body: JSON.stringify({ ticket: issued.ticket, request }), headers: {
          Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': request.requestId,
        },
      }));
      const reserved = { reservedMicrousd: '38', settledMicrousd: null, costStatus: 'reserved_unknown' };
      const first = await send();
      expect(first.status).toBe(504);
      const problem = await first.text();
      expect(JSON.parse(problem)).toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN', retryable: false, state: 'uncertain', cost: reserved });
      expect(problem).not.toContain('private-provider-fixture');
      const retry = await send();
      expect(retry.status).toBe(504);
      expect(await retry.text()).toBe(problem);
      const status = await api(new Request(`${origin}/v1/proposals/${request.requestId}`));
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ state: 'uncertain', resultAvailable: false, cost: reserved });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { env.ledger.close(); }
  });

  it('reports only owned status and keeps exact cost after the proposal expires', async () => {
    let release!: (outcome: typeof validOutcome) => void;
    const completed = new Promise<typeof validOutcome>(resolve => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const provider = vi.fn<Provider>(async () => { started(); return completed; });
    const env = await setup(provider);
    try {
      const job = await env.issue();
      const describe = (owner = subject) => env.service.readRequestStatus(owner, job.requestId);
      const base = { requestId: job.requestId, requestHash: job.requestHash,
        statusExpiresAt: new Date(initialTime + 24 * 60 * 60 * 1_000).toISOString() };
      const cost = { currency: 'USD', unit: 'microdollar', pricePolicyVersion: policy.version };
      const pendingCost = { ...cost, reservedMicrousd: '38', settledMicrousd: null, costStatus: 'reserved' };
      const settledCost = { ...cost, reservedMicrousd: '38', settledMicrousd: '9', costStatus: 'settled_known' };
      expect(await describe()).toEqual({ status: 200, body: { ...base, state: 'issued', resultAvailable: false,
        serverTime: new Date(initialTime).toISOString(), cost: { ...cost, reservedMicrousd: '0', settledMicrousd: '0', costStatus: 'no_charge' } } });
      expect(await describe(wrongSubject)).toEqual(await env.service.readRequestStatus(subject, requestAt(2).requestId));
      expect(await describe(wrongSubject)).toMatchObject({ status: 404, body: { code: 'REQUEST_NOT_FOUND' } });
      const unused = await env.issue(requestAt(2));
      expect(provider).not.toHaveBeenCalled();
      const generating = job.generate();
      await ready;
      expect(await describe()).toMatchObject({ status: 200, body: {
        ...base, state: 'running', resultAvailable: false, cost: pendingCost,
      } });
      env.advance(500);
      release(validOutcome);
      await generating;
      const retained = await describe();
      expect(retained).toMatchObject({ status: 200, body: {
        ...base, state: 'succeeded', resultAvailable: true, cost: settledCost,
        resultExpiresAt: new Date(initialTime + 500 + 15 * 60_000).toISOString(),
        proposal: { requestId: job.requestId, requestHash: job.requestHash, operations: JSON.parse(operations) },
      } });
      env.advance(500 + 15 * 60_000);
      expect(await env.service.readRequestStatus(subject, unused.requestId)).toMatchObject({ status: 200,
        body: { state: 'expired', resultAvailable: false, cost: { reservedMicrousd: '0', settledMicrousd: '0', costStatus: 'no_charge' } } });
      expect(await describe()).toEqual({ status: 410, body: { code: 'RESULT_EXPIRED',
        message: 'The proposal download expired.', requestId: job.requestId, retryable: false,
        serverTime: new Date(initialTime + 500 + 15 * 60_000).toISOString(), state: 'succeeded', cost: settledCost,
      } });
      env.advance(24 * 60 * 60 * 1_000);
      expect(await describe()).toMatchObject({ status: 404, body: { code: 'REQUEST_NOT_FOUND' } });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { env.ledger.close(); }
  });

  it('refuses local API generation at ticket, UUID and future-dated replay boundaries', async () => {
    const origin = 'https://companion.example.invalid';
    const csrf = 'c'.repeat(48);
    const minute = 60_000;
    const day = 24 * 60 * minute;
    const future = 5 * minute;
    const provider = vi.fn<Provider>().mockResolvedValue(validOutcome);
    const env = await setup(provider);
    const api = createLocalCompanionApi({
      origin, generation: env.service, issue: env.issueFromApi, now: env.now,
      async authenticate() {
        const session = apiSession(subject, csrf);
        const expires = new Date(env.now() + minute).toISOString();
        return { ...session, sessionIdleExpiresAt: expires, sessionAbsoluteExpiresAt: expires };
      },
      async logout() {},
    });
    const send = (path: string, body: unknown, idempotencyKey?: string) => api(new Request(origin + path, {
      method: 'POST', body: JSON.stringify(body), headers: {
        Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
    }));
    const ticket = async (request: ReturnType<typeof requestAt>) => {
      const { requestHash } = await parseCompanionRequest(encoder.encode(JSON.stringify(request)));
      return send('/v1/tickets', { requestId: request.requestId, requestHash, acknowledgeBillableRequest: true,
        pricePolicyVersion: policy.version, acknowledgedMaxChargeMicrousd: policy.maxChargeMicrousd });
    };
    const refuse = async (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code, retryable: false });
    };
    try {
      const current = requestAt();
      const futureDated = requestAt(2, initialTime + future);
      await refuse(await ticket(requestAt(3, initialTime + future + 1)), 400, 'REQUEST_CLOCK_SKEW');
      const normalTicket = await ticket(current);
      const futureTicket = await ticket(futureDated);
      expect(normalTicket.status).toBe(201);
      expect(futureTicket.status).toBe(201);
      const normalBody = { request: current, ticket: (await normalTicket.json()).ticket };
      const futureBody = { request: futureDated, ticket: (await futureTicket.json()).ticket };

      env.advance(15 * minute);
      await refuse(await send('/v1/proposals', normalBody, current.requestId), 410, 'TICKET_EXPIRED');
      env.advance(day);
      env.service.cleanup();
      await refuse(await ticket(current), 410, 'REQUEST_EXPIRED');
      await refuse(await ticket(futureDated), 409, 'FRESH_REQUEST_REQUIRED');
      await refuse(await send('/v1/proposals', futureBody, futureDated.requestId), 410, 'TICKET_EXPIRED');
      env.advance(day + future - 1);
      env.service.cleanup();
      await refuse(await ticket(futureDated), 409, 'FRESH_REQUEST_REQUIRED');
      env.advance(day + future);
      env.service.cleanup();
      await refuse(await ticket(futureDated), 410, 'REQUEST_EXPIRED');
      await refuse(await send('/v1/proposals', futureBody, futureDated.requestId), 410, 'REQUEST_EXPIRED');
      expect(provider).not.toHaveBeenCalled();
    } finally { env.ledger.close(); }
  });

  it('reserves before the only provider call and returns one encrypted, subject-bound result twice', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'meridian-local-generation-'));
    const filename = join(folder, 'ledger.sqlite');
    let release!: (value: typeof validOutcome) => void;
    const complete = new Promise<typeof validOutcome>(resolve => { release = resolve; });
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const provider = vi.fn<Provider>(async () => { started(); return complete; });
    const env = await setup(provider, filename);
    const observer = new sqlite!.DatabaseSync(filename);
    try {
      const request = requestAt();
      const job = await env.issue(request);
      expect(await env.service.status(subject, job.requestId)).toMatchObject({ code: 'ISSUED' });
      const owner = job.generate();
      await ready;
      expect(await job.generate()).toEqual({ code: 'STATUS', state: 'running', amountMicrousd: '38' });
      expect(await env.service.status(wrongSubject, job.requestId)).toEqual({ code: 'NOT_FOUND' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(Object.keys(provider.mock.calls[0][0]).sort()).toEqual(['allowedOperations', 'graph', 'instruction', 'scope']);
      expect(provider.mock.calls[0][1]).toEqual({ maxInputTokens: 10, maxOutputTokens: 12 });
      const competing = await env.issue(requestAt(2));
      expect(await competing.generate()).toEqual({ code: 'BUDGET_EXHAUSTED' });
      env.advance(100);
      release(validOutcome);

      const result = await owner;
      expect(result).toMatchObject({ code: 'STATUS', state: 'succeeded', amountMicrousd: '9' });
      if (!('proposal' in result) || !result.proposal) throw new Error('Missing validated proposal');
      expect(JSON.parse(result.proposal)).toMatchObject({
        requestId: job.requestId, requestHash: job.requestHash, schema: 'meridian-proposal/v1', id: expect.any(String),
        origin: 'ai', baseToken: request.baseToken, operations: JSON.parse(operations),
      });
      expect(await job.generate()).toEqual(result);
      expect(await env.service.status(subject, job.requestId)).toEqual(result);
      expect(provider).toHaveBeenCalledTimes(1);
      const sealed = observer.prepare('SELECT ciphertext FROM proposal_results').get()?.ciphertext;
      expect(sealed).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(sealed as Uint8Array).includes(Buffer.from(label))).toBe(false);
      const disk = await readFile(filename);
      expect(disk.includes(Buffer.from(label))).toBe(false);
      expect(disk.includes(Buffer.from(request.instruction))).toBe(false);

      env.advance(900_099);
      expect(await env.service.status(subject, job.requestId)).toEqual(result);
      env.advance(900_100);
      expect(await env.service.status(subject, job.requestId)).toEqual({ code: 'RESULT_EXPIRED', amountMicrousd: '9' });
      env.service.cleanup();
      expect(observer.prepare('SELECT COUNT(*) AS total FROM proposal_results').get()?.total).toBe(0);
      expect(await job.generate()).toEqual({ code: 'TICKET_EXPIRED' });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      release(validOutcome);
      observer.close();
      env.ledger.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('refuses invalid requests, different bodies and mismatched subject or key before invoking the provider', async () => {
    const provider = vi.fn<Provider>().mockResolvedValue(validOutcome);
    const env = await setup(provider);
    try {
      const job = await env.issue();
      expect(await job.generate(job.bytes, 'mismatched')).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(await job.generate(job.bytes, job.requestId, wrongSubject)).toEqual({ code: 'TICKET_INVALID' });
      expect(await job.generate(encoder.encode('{'))).toEqual({ code: 'INVALID_REQUEST' });
      const request = requestAt();
      request.instruction = 'Changed instruction';
      expect(await job.generate(encoder.encode(JSON.stringify(request)))).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(provider).not.toHaveBeenCalled();
      expect(await env.service.status(subject, job.requestId)).toMatchObject({ code: 'ISSUED' });
    } finally { env.ledger.close(); }
  });

  it('settles known costs even where the provider output violates the granted scope', async () => {
    const provider = vi.fn<Provider>().mockResolvedValue({
      ...validOutcome, operations: JSON.stringify([{ op: 'setNodeLabel', label, targetId: requestAt().baseToken.projectId }]),
    });
    const env = await setup(provider);
    try {
      const job = await env.issue();
      expect(await job.generate()).toEqual({ code: 'STATUS', state: 'failed', amountMicrousd: '9' });
      expect(await job.generate()).toEqual({ code: 'STATUS', state: 'failed', amountMicrousd: '9' });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { env.ledger.close(); }
  });

  it('aborts a timed-out call, retains its full reservation and refuses to delegate again', async () => {
    vi.useFakeTimers();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const provider = vi.fn<Provider>(() => { entered(); return new Promise(() => {}); });
    const env = await setup(provider);
    try {
      const job = await env.issue();
      const pending = job.generate();
      await started;
      await vi.advanceTimersByTimeAsync(24_999);
      expect((await env.service.status(subject, job.requestId))).toEqual({ code: 'STATUS', state: 'running', amountMicrousd: '38' });
      await vi.advanceTimersByTimeAsync(1);
      const uncertain = { code: 'STATUS', state: 'uncertain', amountMicrousd: '38' };
      expect(await pending).toEqual(uncertain);
      expect(provider.mock.calls[0][2].aborted).toBe(true);
      expect(await env.service.status(subject, job.requestId)).toEqual(uncertain);
      expect(await env.service.readRequestStatus(subject, job.requestId)).toMatchObject({ status: 200, body: {
        state: 'uncertain', resultAvailable: false, cost: { reservedMicrousd: '38', settledMicrousd: null, costStatus: 'reserved_unknown' },
      } });
      expect(await job.generate()).toEqual(uncertain);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { env.ledger.close(); vi.useRealTimers(); }
  });

  it('rolls back settlement if encrypted retention cannot be committed and prevents later provider calls', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'meridian-proposal-rollback-'));
    const filename = join(folder, 'ledger.sqlite');
    const provider = vi.fn<Provider>().mockResolvedValue(validOutcome);
    const env = await setup(provider, filename);
    const observer = new sqlite!.DatabaseSync(filename);
    try {
      observer.exec(`
        CREATE TRIGGER deny_proposal BEFORE INSERT ON proposal_results
        BEGIN SELECT RAISE(ABORT, 'fixture'); END;
      `);
      const job = await env.issue();
      expect(await job.generate()).toEqual({ code: 'STATUS', state: 'uncertain', amountMicrousd: '38' });
      expect(observer.prepare('SELECT amount FROM daily_commitments').all().map(row => row.amount)).toEqual([38, 38]);
      observer.exec('DROP TRIGGER deny_proposal');
      expect(await job.generate()).toEqual({ code: 'STATUS', state: 'uncertain', amountMicrousd: '38' });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      observer.close();
      env.ledger.close();
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('recovers a crashed reservation through cleanup without calling the provider', async () => {
    const provider = vi.fn<Provider>().mockResolvedValue(validOutcome);
    const env = await setup(provider);
    try {
      const job = await env.issue();
      expect(env.ledger.reserve(job.issued.claims, job.requestId, job.requestHash, initialTime).code).toBe('RESERVED');
      env.advance(29_999);
      env.service.cleanup();
      expect(await env.service.status(subject, job.requestId)).toMatchObject({ state: 'running' });
      env.advance(30_000);
      env.service.cleanup();
      expect(await env.service.status(subject, job.requestId)).toEqual({ code: 'STATUS', state: 'uncertain', amountMicrousd: '38' });
      expect(await job.generate()).toMatchObject({ state: 'uncertain' });
      expect(provider).not.toHaveBeenCalled();
    } finally { env.ledger.close(); }
  });
});
