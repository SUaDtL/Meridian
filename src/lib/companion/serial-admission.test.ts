import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { VerifiedGenerationTicket } from './serial-admission';
import type { PricePolicy } from './price-policy';

// Node 22.12 exposes SQLite when the runtime flag is enabled. The pinned
// CI version runs these reference-ledger cases with its built-in module.
const sqlite = await import('node:sqlite').catch(error => {
  if (error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE') return undefined;
  throw error;
});
const CompanionAdmissionLedger = sqlite ? (await import('./serial-admission')).CompanionAdmissionLedger : undefined;

const now = Date.parse('2026-11-20T07:00:00Z');
const subject = 'a'.repeat(64);
const otherSubject = 'b'.repeat(64);
const requestHash = 'e'.repeat(64);
const pricePolicy: PricePolicy = {
  version: 'design-fixture.v1', currency: 'USD', unit: 'microdollar', maxInputTokens: 32_768, maxOutputTokens: 4096,
  inputMicrousdPerMillionTokens: '1000000', outputMicrousdPerMillionTokens: '5000000',
  fixedUpperBoundMicrousd: '0', maxChargeMicrousd: '53248', displayLabel: 'Fictitious design tariff',
};
const charge = BigInt(pricePolicy.maxChargeMicrousd);
const ordinaryLimits = { pricePolicy, dailySubjectMicrousd: charge * 5n, dailyGlobalMicrousd: charge * 40n };

function ticket(index: number, subjectBinding = subject, at = now): VerifiedGenerationTicket {
  const time = at.toString(16).padStart(12, '0');
  const suffix = index.toString(16).padStart(12, '0');
  return {
    jti: `b28ae7c1-4180-4000-8000-${suffix}`,
    subjectBinding, requestId: `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${suffix}`,
    requestHash, iat: at / 1000, exp: at / 1000 + 900, pricePolicyVersion: pricePolicy.version,
    maxChargeMicrousd: pricePolicy.maxChargeMicrousd,
  };
}

async function withLedgerFile(work: (filename: string) => Promise<void>) {
  const folder = await mkdtemp(join(tmpdir(), 'meridian-admission-'));
  try { await work(join(folder, 'ledger.sqlite')); }
  finally { await rm(folder, { recursive: true, force: true }); }
}

describe.skipIf(!sqlite)('local serial companion admission', () => {
  it('consumes one ticket once, bounds its lifetime and rejects changed body and price', () => {
    const ledger = new CompanionAdmissionLedger!(':memory:', ordinaryLimits);
    try {
      const grant = ticket(1);
      const submit = (verified = grant, hash = requestHash, at = now) => ledger.reserve(verified, verified.requestId, hash, at);
      expect(submit(grant, 'f'.repeat(64))).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(submit({ ...grant, maxChargeMicrousd: '53249' })).toEqual({ code: 'PRICE_POLICY_CHANGED' });
      expect(submit(grant, requestHash, now + 900_000)).toEqual({ code: 'TICKET_EXPIRED' });
      expect(submit(grant, requestHash, now + 86_400_000)).toEqual({ code: 'REQUEST_EXPIRED' });
      expect(submit()).toEqual({ code: 'RESERVED', amount: charge });
      expect(submit()).toEqual({ code: 'EXISTING', state: 'running', amount: charge });
      expect(submit({ ...ticket(2), requestId: grant.requestId })).toEqual({ code: 'IDEMPOTENCY_CONFLICT' });
      expect(submit({ ...grant, requestId: ticket(2).requestId, subjectBinding: otherSubject })).toEqual({ code: 'TICKET_INVALID' });
    } finally { ledger.close(); }
  });

  it('preserves unknown cost through watchdog recovery and releases only the verified difference once', () => {
    const ledger = new CompanionAdmissionLedger!(':memory:', { ...ordinaryLimits, dailyGlobalMicrousd: charge + 1n });
    try {
      const first = ticket(1);
      const next = ticket(2);
      const submit = (grant: VerifiedGenerationTicket, at = now) => ledger.reserve(grant, grant.requestId, requestHash, at);
      expect(submit(first).code).toBe('RESERVED');
      expect(ledger.reconcileAbandoned(now + 29_999)).toBe(0);
      expect(ledger.reconcileAbandoned(now + 30_000)).toBe(1);
      expect(submit(first, now + 31_000)).toEqual({ code: 'EXISTING', state: 'uncertain', amount: charge });
      expect(submit(next, now + 31_000).code).toBe('BUDGET_EXHAUSTED');
      expect(() => ledger.settleKnown(first, 'succeeded', charge + 1n)).toThrow(RangeError);
      expect(submit(first, now + 31_000)).toEqual({ code: 'EXISTING', state: 'uncertain', amount: charge });
      expect(ledger.settleKnown(first, 'succeeded', 1n)).toBe(true);
      expect(ledger.settleKnown(first, 'succeeded', 0n)).toBe(false);
      expect(submit(first, now + 31_000)).toEqual({ code: 'EXISTING', state: 'succeeded', amount: 1n });
      expect(submit(next, now + 31_000).code).toBe('RESERVED');
      expect(ledger.markUncertain(next)).toBe(true);
      expect(ledger.markUncertain(next)).toBe(false);
    } finally { ledger.close(); }
  });

  it('enforces subject concurrency and starts per minute independently of released microdollars', () => {
    const ledger = new CompanionAdmissionLedger!(':memory:', ordinaryLimits);
    try {
      const submit = (grant: VerifiedGenerationTicket, at = now) => ledger.reserve(grant, grant.requestId, requestHash, at);
      const first = ticket(1);
      const second = ticket(2);
      expect(submit(first).code).toBe('RESERVED');
      expect(submit(second).code).toBe('RESERVED');
      expect(submit(ticket(3)).code).toBe('RATE_LIMITED');
      ledger.settleKnown(first, 'failed', 0n);
      ledger.settleKnown(second, 'failed', 0n);
      for (let i = 3; i <= 5; i++) {
        const grant = ticket(i);
        expect(submit(grant).code).toBe('RESERVED');
        expect(ledger.settleKnown(grant, 'succeeded', 0n)).toBe(true);
      }
      expect(submit(ticket(6), now + 59_999).code).toBe('RATE_LIMITED');
      expect(submit(ticket(6), now + 60_000).code).toBe('RESERVED');
    } finally { ledger.close(); }
  });

  it('rolls back both the generation and subject commitment when the global write fails', async () => {
    await withLedgerFile(async filename => {
      const ledger = new CompanionAdmissionLedger!(filename, { ...ordinaryLimits, dailySubjectMicrousd: charge });
      const observer = new sqlite!.DatabaseSync(filename);
      try {
        observer.exec(`CREATE TRIGGER stop_global BEFORE INSERT ON daily_commitments WHEN NEW.bucket = '*'
          BEGIN SELECT RAISE(ABORT, 'fixture global write failed'); END;`);
        const grant = ticket(1);
        const submit = () => ledger.reserve(grant, grant.requestId, requestHash, now);
        expect(submit).toThrow('fixture global write failed');
        expect(observer.prepare('SELECT COUNT(*) as count FROM generations').get()?.count).toBe(0);
        expect(observer.prepare('SELECT COUNT(*) as count FROM daily_commitments').get()?.count).toBe(0);
        observer.exec('DROP TRIGGER stop_global');
        expect(submit()).toEqual({ code: 'RESERVED', amount: charge });
      } finally { observer.close(); ledger.close(); }
    });
  });

  it.each(['subject', 'global'] as const)('permits one owner in a real database race for the %s cap', async cap => {
    await withLedgerFile(async filename => {
      const limits = { ...ordinaryLimits,
        ...(cap === 'subject' ? { dailySubjectMicrousd: charge } : { dailyGlobalMicrousd: charge }),
      };
      const gate = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
      const grants = [ticket(1), ticket(2, cap === 'subject' ? subject : otherSubject)];
      const workers = grants.map(grant => new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          const { CompanionAdmissionLedger } = await import(workerData.moduleUrl);
          const ledger = new CompanionAdmissionLedger(workerData.filename, workerData.limits);
          try {
            parentPort.postMessage('ready');
            Atomics.wait(workerData.gate, 0, 0, 5000);
            const { grant, now } = workerData;
            const result = ledger.reserve(grant, grant.requestId, grant.requestHash, now);
            parentPort.postMessage(result.code);
          } finally { ledger.close(); }
        })().catch(error => { throw error; });
      `, { eval: true, execArgv: ['--experimental-sqlite', '--experimental-strip-types'], workerData: {
        moduleUrl: new URL('./serial-admission.ts', import.meta.url).href, filename, limits, gate, grant, now,
      } }));
      try {
        let ready = 0;
        const results = await Promise.all(workers.map(worker => new Promise<string>((resolve, reject) => {
          worker.once('error', reject);
          worker.once('exit', code => { if (code) reject(new Error(`Admission worker exited with code ${code}.`)); });
          worker.on('message', message => {
            if (message !== 'ready') { resolve(message); return; }
            if (++ready === workers.length) {
              Atomics.store(gate, 0, 1);
              Atomics.notify(gate, 0);
            }
          });
        })));
        expect(results.sort()).toEqual(['BUDGET_EXHAUSTED', 'RESERVED']);
      } finally { await Promise.all(workers.map(worker => worker.terminate())); }
    });
  }, 15_000);
});
