import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CompanionGeneration } from './generation';
import { issueCompanionTicket } from './issue-ticket';
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

function requestAt(index = 1) {
  const timestamp = initialTime.toString(16).padStart(12, '0');
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

  return { ledger, keys, resultKey, service, issue, advance: (ms: number) => { now = initialTime + ms; } };
}

describe.skipIf(!sqlite)('local companion generation with a provider stub', () => {
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
