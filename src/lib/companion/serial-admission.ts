import { DatabaseSync } from 'node:sqlite';
import { checkRequestClock, checkTicketClock } from './admission-clock.ts';
import { priceCeiling, type PricePolicy } from './price-policy.ts';

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60_000;
const moneyLimit = 999_999_999_999_999n;
const globalBucket = '*';
const digestPattern = /^[0-9a-f]{64}$/;
const ticketIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type VerifiedGenerationTicket = {
  jti: string;
  subjectBinding: string;
  requestId: string;
  requestHash: string;
  iat: number;
  exp: number;
  pricePolicyVersion: string;
  maxChargeMicrousd: string;
};

type GenerationState = 'running' | 'uncertain' | 'succeeded' | 'failed';
type Result =
  | { code: 'RESERVED'; amount: bigint }
  | { code: 'EXISTING'; state: GenerationState; amount: bigint }
  | { code: 'INVALID_REQUEST' | 'REQUEST_CLOCK_SKEW' | 'REQUEST_EXPIRED' | 'TICKET_INVALID' | 'TICKET_EXPIRED' |
      'IDEMPOTENCY_CONFLICT' | 'PRICE_POLICY_CHANGED' | 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

type Limits = {
  pricePolicy: PricePolicy;
  dailySubjectMicrousd: bigint;
  dailyGlobalMicrousd: bigint;
};

const schema = `
  CREATE TABLE IF NOT EXISTS generations (
    subject TEXT NOT NULL,
    request_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    started_ms INTEGER NOT NULL,
    day INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    state TEXT NOT NULL CHECK (state IN ('running', 'uncertain', 'succeeded', 'failed')),
    PRIMARY KEY (subject, request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS generation_subject_time ON generations (subject, started_ms);
  CREATE INDEX IF NOT EXISTS generation_state ON generations (state);
  CREATE TABLE IF NOT EXISTS daily_commitments (
    day INTEGER NOT NULL,
    bucket TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (day, bucket)
  ) STRICT;
`;

function fitsPattern(value: string, pattern: RegExp, length: number): boolean {
  return typeof value === 'string' && value.length === length && pattern.test(value);
}

function validCap(value: bigint): boolean {
  return typeof value === 'bigint' && value > 0n && value <= moneyLimit;
}

/** Local companion reference ledger. The caller verifies ticket signature, session,
 *  canonical request hash and operation scope before handing it a ticket. */
export class CompanionAdmissionLedger {
  private readonly db: DatabaseSync;
  private readonly charge: bigint;
  private readonly version: string;
  private readonly dailySubjectCap: bigint;
  private readonly dailyGlobalCap: bigint;

  constructor(filename: string, limits: Limits) {
    if (!validCap(limits.dailySubjectMicrousd) || !validCap(limits.dailyGlobalMicrousd)) {
      throw new RangeError('Configure positive daily companion spending caps.');
    }
    this.charge = priceCeiling(limits.pricePolicy);
    this.version = limits.pricePolicy.version;
    this.dailySubjectCap = limits.dailySubjectMicrousd;
    this.dailyGlobalCap = limits.dailyGlobalMicrousd;
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec('PRAGMA busy_timeout = 2500');
      this.db.exec(schema);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  reserve(ticket: VerifiedGenerationTicket, requestId: string, requestHash: string, nowMs: number): Result {
    const clock = checkRequestClock(requestId, nowMs);
    if (clock.code !== 'ELIGIBLE') return { code: clock.code };
    if (!fitsPattern(ticket.jti, ticketIdPattern, 36) || !fitsPattern(ticket.subjectBinding, digestPattern, 64)
      || !fitsPattern(ticket.requestHash, digestPattern, 64) || ticket.requestId !== requestId) {
      return { code: 'TICKET_INVALID' };
    }
    if (!fitsPattern(requestHash, digestPattern, 64)) return { code: 'INVALID_REQUEST' };
    if (ticket.requestHash !== requestHash) return { code: 'IDEMPOTENCY_CONFLICT' };
    const ticketClock = checkTicketClock(ticket.iat, ticket.exp, nowMs);
    if (ticketClock !== 'ELIGIBLE') return { code: ticketClock };
    if (ticket.pricePolicyVersion !== this.version || ticket.maxChargeMicrousd !== this.charge.toString()) {
      return { code: 'PRICE_POLICY_CHANGED' };
    }

    return this.transaction(() => {
      const existing = this.db.prepare(`
        SELECT ticket_id, request_hash, state, CAST(amount AS TEXT) AS amount
        FROM generations WHERE subject = ? AND request_id = ?
      `).get(ticket.subjectBinding, requestId);
      if (existing) {
        return existing.ticket_id === ticket.jti && existing.request_hash === requestHash
          ? { code: 'EXISTING', state: existing.state as GenerationState, amount: BigInt(String(existing.amount)) }
          : { code: 'IDEMPOTENCY_CONFLICT' };
      }
      if (this.db.prepare('SELECT 1 FROM generations WHERE ticket_id = ?').get(ticket.jti)) {
        return { code: 'TICKET_INVALID' };
      }
      const starts = this.db.prepare('SELECT COUNT(*) AS count FROM generations WHERE subject = ? AND started_ms > ?')
        .get(ticket.subjectBinding, nowMs - minuteMs)?.count;
      const subjectRunning = this.db.prepare("SELECT COUNT(*) AS count FROM generations WHERE subject = ? AND state = 'running'")
        .get(ticket.subjectBinding)?.count;
      const globalRunning = this.db.prepare("SELECT COUNT(*) AS count FROM generations WHERE state = 'running'").get()?.count;
      if (Number(starts) >= 5 || Number(subjectRunning) >= 2 || Number(globalRunning) >= 20) return { code: 'RATE_LIMITED' };

      const day = Math.floor(nowMs / dayMs);
      if (this.commitment(day, ticket.subjectBinding) + this.charge > this.dailySubjectCap ||
          this.commitment(day, globalBucket) + this.charge > this.dailyGlobalCap) {
        return { code: 'BUDGET_EXHAUSTED' };
      }
      this.db.prepare(`
        INSERT INTO generations (subject, request_id, ticket_id, request_hash, started_ms, day, amount, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
      `).run(ticket.subjectBinding, requestId, ticket.jti, requestHash, nowMs, day, this.charge);
      this.adjustCommitment(day, ticket.subjectBinding, this.charge);
      this.adjustCommitment(day, globalBucket, this.charge);
      return { code: 'RESERVED', amount: this.charge };
    });
  }

  markUncertain(ticket: VerifiedGenerationTicket): boolean {
    const updated = this.db.prepare(`
      UPDATE generations SET state = 'uncertain'
      WHERE subject = ? AND request_id = ? AND ticket_id = ? AND request_hash = ? AND state = 'running'
    `).run(ticket.subjectBinding, ticket.requestId, ticket.jti, ticket.requestHash);
    return updated.changes === 1;
  }

  reconcileAbandoned(nowMs: number): number {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid server clock');
    const update = this.db.prepare("UPDATE generations SET state = 'uncertain' WHERE state = 'running' AND started_ms <= ?");
    return Number(update.run(nowMs - 30_000).changes);
  }

  settleKnown(ticket: VerifiedGenerationTicket, state: 'succeeded' | 'failed', actualMicrousd: bigint): boolean {
    if (typeof actualMicrousd !== 'bigint' || actualMicrousd < 0n) throw new RangeError('Invalid known provider cost.');
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT day, CAST(amount AS TEXT) AS amount FROM generations
        WHERE subject = ? AND request_id = ? AND ticket_id = ? AND request_hash = ?
          AND state IN ('running', 'uncertain')
      `).get(ticket.subjectBinding, ticket.requestId, ticket.jti, ticket.requestHash);
      if (!row) return false;
      const reserved = BigInt(String(row.amount));
      if (actualMicrousd > reserved) throw new RangeError('Known provider cost exceeds its reservation.');
      this.db.prepare("UPDATE generations SET state = ?, amount = ? WHERE subject = ? AND request_id = ?")
        .run(state, actualMicrousd, ticket.subjectBinding, ticket.requestId);
      const release = reserved - actualMicrousd;
      const update = this.db.prepare("UPDATE daily_commitments SET amount = amount - ? WHERE day = ? AND bucket = ?");
      for (const bucket of [ticket.subjectBinding, globalBucket]) {
        const changed = update.run(release, Number(row.day), bucket);
        if (changed.changes !== 1) throw new Error('Generation commitment is missing.');
      }
      return true;
    });
  }

  private commitment(day: number, bucket: string): bigint {
    const row = this.db.prepare('SELECT CAST(amount AS TEXT) AS amount FROM daily_commitments WHERE day = ? AND bucket = ?')
      .get(day, bucket);
    return row ? BigInt(String(row.amount)) : 0n;
  }

  private adjustCommitment(day: number, bucket: string, delta: bigint) {
    this.db.prepare(`
      INSERT INTO daily_commitments (day, bucket, amount) VALUES (?, ?, ?)
      ON CONFLICT (day, bucket) DO UPDATE SET amount = amount + excluded.amount
    `).run(day, bucket, delta);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
