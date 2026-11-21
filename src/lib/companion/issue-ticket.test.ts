import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { issueCompanionTicket } from './issue-ticket';
import type { PricePolicy } from './price-policy';
import { verifyCompanionTicket } from './signed-ticket';

const sqlite = await import('node:sqlite').catch(error => {
  if (error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE') return undefined;
  throw error;
});
const Ledger = sqlite ? (await import('./serial-admission')).CompanionAdmissionLedger : undefined;
const now = Date.parse('2026-11-20T07:00:00Z');
const hour = 60 * 60 * 1000;
const subject = '1'.repeat(64);
const policy: PricePolicy = {
  version: 'example-tariff.v1', currency: 'USD', unit: 'microdollar', maxInputTokens: 1, maxOutputTokens: 1,
  inputMicrousdPerMillionTokens: '1000000', outputMicrousdPerMillionTokens: '2000000',
  fixedUpperBoundMicrousd: '0', maxChargeMicrousd: '3', displayLabel: 'Test price',
};
const caps = { pricePolicy: policy, dailySubjectMicrousd: 12n, dailyGlobalMicrousd: 12n };

function requestAt(at = now, index = 1) {
  const time = at.toString(16).padStart(12, '0');
  const suffix = index.toString(16).padStart(12, '0');
  return {
    requestId: `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${suffix}`,
    requestHash: 'a'.repeat(64),
    acknowledgeBillableRequest: true, pricePolicyVersion: policy.version, acknowledgedMaxChargeMicrousd: '3',
  };
}

async function localKey(id: string) {
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  return { id, key };
}

describe.skipIf(!sqlite)('local companion issuance and replay retention', () => {
  it('repeats the original token and expiry across key rotation and rejects reuse after generation starts', async () => {
    const ledger = new Ledger!(':memory:', caps);
    try {
      const [previous, current] = await Promise.all([localKey('previous'), localKey('current')]);
      const keys = new Map([[previous.id, previous.key], [current.id, current.key]]);
      const request = requestAt();
      const initial = await issueCompanionTicket(request, subject, previous, keys, policy, ledger, now);
      if (initial.code !== 'ISSUED') throw new Error('Expected initial ticket');
      expect(await issueCompanionTicket(request, subject, current, keys, policy, ledger, now + 30_000))
        .toEqual({ ...initial, code: 'EXISTING' });
      expect(await issueCompanionTicket({ ...request, requestHash: 'b'.repeat(64) }, subject, current, keys, policy, ledger, now))
        .toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(await issueCompanionTicket(request, subject, current, keys, policy, ledger, now + 900_000))
        .toEqual({ code: 'TICKET_EXPIRED' });

      const parsed = await verifyCompanionTicket(initial.ticket, subject, keys, now + 500);
      if (parsed.code !== 'VERIFIED') throw new Error('Expected verified issued ticket');
      expect(ledger.reserve(parsed.claims, request.requestId, request.requestHash, now + 500))
        .toEqual({ code: 'RESERVED', amount: 3n });
      expect(ledger.reserve(parsed.claims, request.requestId, request.requestHash, now + 500))
        .toEqual({ code: 'EXISTING', state: 'running', amount: 3n });
      expect(await issueCompanionTicket(request, subject, current, keys, policy, ledger, now + 500))
        .toEqual({ code: 'REQUEST_ALREADY_STARTED' });
    } finally { ledger.close(); }
  });

  it('removes request details at 24 hours and retains only the bounded future-dated replay marker', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'meridian-ticket-retention-'));
    const filename = join(folder, 'ledger.sqlite');
    const ledger = new Ledger!(filename, caps);
    const observer = new sqlite!.DatabaseSync(filename);
    try {
      const key = await localKey('active');
      const keys = new Map([[key.id, key.key]]);
      const request = requestAt(now + 300_000);
      const initial = await issueCompanionTicket(request, subject, key, keys, policy, ledger, now);
      if (initial.code !== 'ISSUED') throw new Error('Expected first ticket');
      expect(ledger.reserve(initial.claims, request.requestId, request.requestHash, now).code).toBe('RESERVED');
      const cutoff = now + 24 * hour;
      ledger.pruneExpired(cutoff - 1);
      expect(observer.prepare('SELECT COUNT(*) AS count FROM ticket_issuance').get()?.count).toBe(1);
      ledger.pruneExpired(cutoff);
      expect(observer.prepare('SELECT COUNT(*) AS count FROM ticket_issuance').get()?.count).toBe(0);
      expect(observer.prepare('SELECT COUNT(*) AS count FROM generations').get()?.count).toBe(0);
      const marker = observer.prepare('SELECT * FROM replay_tombstones').get();
      expect(marker).toEqual({ subject, request_id: request.requestId, expires_ms: cutoff + 300_000 });
      expect(observer.prepare('SELECT amount FROM daily_commitments').all().map(row => row.amount)).toEqual([3, 3]);
      expect(await issueCompanionTicket(request, subject, key, keys, policy, ledger, cutoff))
        .toEqual({ code: 'FRESH_REQUEST_REQUIRED' });
      ledger.pruneExpired(cutoff + 300_000);
      expect(observer.prepare('SELECT COUNT(*) AS count FROM replay_tombstones').get()?.count).toBe(0);
      expect(await issueCompanionTicket(request, subject, key, keys, policy, ledger, cutoff + 300_000))
        .toEqual({ code: 'REQUEST_EXPIRED' });
    } finally { observer.close(); ledger.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it('counts distinct ticket issuances separately from generation and treats same-ticket retry as read-only', async () => {
    const ledger = new Ledger!(':memory:', caps);
    try {
      const key = await localKey('active');
      const keys = new Map([[key.id, key.key]]);
      const issue = (index: number, at: number) => issueCompanionTicket(requestAt(now, index), subject, key, keys, policy, ledger, at);
      for (let index = 1; index <= 10; index++) expect((await issue(index, now)).code).toBe('ISSUED');
      expect((await issue(1, now + 59_999)).code).toBe('EXISTING');
      expect((await issue(11, now + 59_999)).code).toBe('RATE_LIMITED');
      expect((await issue(11, now + 60_000)).code).toBe('ISSUED');
    } finally { ledger.close(); }
  });
});
