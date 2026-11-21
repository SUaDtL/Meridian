import { DatabaseSync } from 'node:sqlite';
import { assistRequestTimestamp } from '../authoring/assist-request-id.ts';
import { checkRequestClock, checkTicketClock, requestRetention } from './admission-clock.ts';
import { priceCeiling, type PricePolicy } from './price-policy.ts';
import type { TicketClaims } from './signed-ticket.ts';

const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60_000;
const resultLifetimeMs = 15 * minuteMs;
const maxSealedResultBytes = 128 * 1024 + 12 + 16;
const moneyLimit = 999_999_999_999_999n;
const globalBucket = '*';
const digestPattern = /^[0-9a-f]{64}$/;
const keyIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
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
type RetainedResult = { bytes: Uint8Array; completedAtMs: number };
type GenerationStatus =
  | { code: 'NOT_FOUND' }
  | { code: 'ISSUED'; ticketExpiresAtMs: number }
  | { code: 'STATUS'; state: GenerationState; amount: bigint; sealedResult?: Uint8Array };
type OwnedGeneration = {
  requestHash: string;
  policyVersion: string;
  ticketExpiresAtMs: number;
  statusExpiresAtMs: number;
  maximumCharge: string;
} & ({ state: 'issued' } | {
  state: GenerationState;
  settledOrReserved: string;
  result?: { bytes: Uint8Array; expiresAtMs: number };
});
type Result =
  | { code: 'RESERVED'; amount: bigint }
  | { code: 'EXISTING'; state: GenerationState; amount: bigint }
  | { code: 'INVALID_REQUEST' | 'REQUEST_CLOCK_SKEW' | 'REQUEST_EXPIRED' | 'TICKET_INVALID' | 'TICKET_EXPIRED' |
      'IDEMPOTENCY_CONFLICT' | 'PRICE_POLICY_CHANGED' | 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

type Issuance =
  | { code: 'ISSUED'; claims: TicketClaims; keyId: string }
  | { code: 'EXISTING'; claims: TicketClaims; keyId: string }
  | { code: 'INVALID_REQUEST' | 'REQUEST_CLOCK_SKEW' | 'REQUEST_EXPIRED' | 'TICKET_INVALID' | 'TICKET_EXPIRED' |
      'IDEMPOTENCY_CONFLICT' | 'PRICE_POLICY_CHANGED' | 'RATE_LIMITED' | 'REQUEST_ALREADY_STARTED' | 'FRESH_REQUEST_REQUIRED' };

type Limits = {
  pricePolicy: PricePolicy;
  dailySubjectMicrousd: bigint;
  dailyGlobalMicrousd: bigint;
};

const schema = `
  CREATE TABLE IF NOT EXISTS ticket_issuance (
    subject TEXT NOT NULL,
    request_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    key_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    max_charge TEXT NOT NULL,
    issued_seconds INTEGER NOT NULL,
    expires_seconds INTEGER NOT NULL,
    issued_ms INTEGER NOT NULL,
    status_expires_ms INTEGER NOT NULL,
    replay_expires_ms INTEGER NOT NULL,
    PRIMARY KEY (subject, request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS ticket_subject_time ON ticket_issuance (subject, issued_ms);
  CREATE INDEX IF NOT EXISTS ticket_retention ON ticket_issuance (status_expires_ms);
  CREATE TABLE IF NOT EXISTS replay_tombstones (
    subject TEXT NOT NULL,
    request_id TEXT NOT NULL,
    expires_ms INTEGER NOT NULL,
    PRIMARY KEY (subject, request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS tombstone_retention ON replay_tombstones (expires_ms);
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
  CREATE TABLE IF NOT EXISTS proposal_results (
    ticket_id TEXT PRIMARY KEY REFERENCES generations (ticket_id) ON DELETE CASCADE,
    expires_ms INTEGER NOT NULL,
    ciphertext BLOB NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS proposal_retention ON proposal_results (expires_ms);
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
      this.db.exec('PRAGMA busy_timeout = 2500; PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;');
      this.db.exec(schema);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  registerIssuance(proposed: TicketClaims, keyId: string, nowMs: number): Issuance {
    const retention = requestRetention(proposed.requestId, nowMs);
    if (retention.code !== 'ELIGIBLE') return { code: retention.code };
    if (!fitsPattern(proposed.jti, ticketIdPattern, 36) || !fitsPattern(proposed.subjectBinding, digestPattern, 64) ||
        !fitsPattern(proposed.requestHash, digestPattern, 64) || keyIdPattern.exec(keyId)?.[0] !== keyId ||
        proposed.iat !== Math.floor(nowMs / 1000) || checkTicketClock(proposed.iat, proposed.exp, nowMs) !== 'ELIGIBLE') {
      return { code: 'TICKET_INVALID' };
    }
    if (proposed.pricePolicyVersion !== this.version || proposed.maxChargeMicrousd !== this.charge.toString()) {
      return { code: 'PRICE_POLICY_CHANGED' };
    }

    return this.transaction(() => {
      const subject = proposed.subjectBinding;
      const requestId = proposed.requestId;
      const tombstone = this.db.prepare('SELECT 1 FROM replay_tombstones WHERE subject = ? AND request_id = ? AND expires_ms > ?')
        .get(subject, requestId, nowMs);
      if (tombstone) return { code: 'FRESH_REQUEST_REQUIRED' };
      const existing = this.db.prepare('SELECT * FROM ticket_issuance WHERE subject = ? AND request_id = ?').get(subject, requestId);
      if (existing) {
        if (Number(existing.status_expires_ms) <= nowMs) return { code: 'FRESH_REQUEST_REQUIRED' };
        if (existing.request_hash !== proposed.requestHash) return { code: 'IDEMPOTENCY_CONFLICT' };
        if (this.db.prepare('SELECT 1 FROM generations WHERE subject = ? AND request_id = ?').get(subject, requestId)) {
          return { code: 'REQUEST_ALREADY_STARTED' };
        }
        if (nowMs >= Number(existing.expires_seconds) * 1000) return { code: 'TICKET_EXPIRED' };
        return { code: 'EXISTING', keyId: String(existing.key_id), claims: Object.freeze({
          ...proposed, jti: String(existing.ticket_id), iat: Number(existing.issued_seconds), exp: Number(existing.expires_seconds),
          pricePolicyVersion: String(existing.policy_version), maxChargeMicrousd: String(existing.max_charge),
        }) };
      }
      const rate = this.db.prepare('SELECT COUNT(*) AS count FROM ticket_issuance WHERE subject = ? AND issued_ms > ?')
        .get(subject, nowMs - minuteMs)?.count;
      if (Number(rate) >= 10) return { code: 'RATE_LIMITED' };
      this.db.prepare(`
        INSERT INTO ticket_issuance (subject, request_id, ticket_id, request_hash, key_id, policy_version, max_charge,
          issued_seconds, expires_seconds, issued_ms, status_expires_ms, replay_expires_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(subject, requestId, proposed.jti, proposed.requestHash, keyId, proposed.pricePolicyVersion, proposed.maxChargeMicrousd,
        proposed.iat, proposed.exp, nowMs, retention.statusExpiresAtMs, retention.tombstoneExpiresAtMs);
      return { code: 'ISSUED', keyId, claims: proposed };
    });
  }

  pruneExpired(nowMs: number) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid server clock');
    this.transaction(() => {
      this.db.prepare('DELETE FROM proposal_results WHERE expires_ms <= ?').run(nowMs);
      this.db.prepare(`
        INSERT INTO replay_tombstones (subject, request_id, expires_ms)
        SELECT subject, request_id, replay_expires_ms FROM ticket_issuance
        WHERE status_expires_ms <= ? AND replay_expires_ms > ?
        ON CONFLICT (subject, request_id) DO UPDATE SET expires_ms = excluded.expires_ms
      `).run(nowMs, nowMs);
      this.db.prepare(`
        DELETE FROM generations WHERE EXISTS (
          SELECT 1 FROM ticket_issuance WHERE ticket_issuance.ticket_id = generations.ticket_id AND status_expires_ms <= ?
        )
      `).run(nowMs);
      this.db.prepare('DELETE FROM ticket_issuance WHERE status_expires_ms <= ?').run(nowMs);
      this.db.prepare('DELETE FROM replay_tombstones WHERE expires_ms <= ?').run(nowMs);
      this.db.prepare('DELETE FROM daily_commitments WHERE day < ?').run(Math.floor(nowMs / dayMs) - 59);
    });
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
      const issued = this.db.prepare(`
        SELECT ticket_id, request_hash, issued_seconds, expires_seconds, policy_version, max_charge
        FROM ticket_issuance WHERE subject = ? AND request_id = ?
      `).get(ticket.subjectBinding, requestId);
      if (!issued || issued.ticket_id !== ticket.jti || issued.request_hash !== requestHash ||
          issued.issued_seconds !== ticket.iat || issued.expires_seconds !== ticket.exp ||
          issued.policy_version !== ticket.pricePolicyVersion || issued.max_charge !== ticket.maxChargeMicrousd) {
        return { code: 'TICKET_INVALID' };
      }
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

  status(subject: string, requestId: string, nowMs: number): GenerationStatus {
    const record = this.ownedGeneration(subject, requestId, nowMs);
    if (!record) return { code: 'NOT_FOUND' };
    if (record.state === 'issued') return { code: 'ISSUED', ticketExpiresAtMs: record.ticketExpiresAtMs };
    const result = record.result ? { sealedResult: record.result.bytes } : {};
    return { code: 'STATUS', state: record.state, amount: BigInt(record.settledOrReserved), ...result };
  }

  ownedGeneration(subject: string, requestId: string, nowMs: number): OwnedGeneration | undefined {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid server clock');
    if (!fitsPattern(subject, digestPattern, 64) || assistRequestTimestamp(requestId) === undefined) return;
    const row = this.db.prepare(`
      SELECT i.request_hash, i.policy_version, i.max_charge, i.expires_seconds, i.status_expires_ms,
        g.state, CAST(g.amount AS TEXT) AS amount, r.expires_ms AS result_expires_ms, r.ciphertext
      FROM ticket_issuance i
      LEFT JOIN generations g ON g.ticket_id = i.ticket_id
      LEFT JOIN proposal_results r ON r.ticket_id = i.ticket_id AND r.expires_ms > ?
      WHERE i.subject = ? AND i.request_id = ? AND i.status_expires_ms > ?
    `).get(nowMs, subject, requestId, nowMs);
    if (!row) return;
    const metadata = {
      requestHash: String(row.request_hash), policyVersion: String(row.policy_version), maximumCharge: String(row.max_charge),
      ticketExpiresAtMs: Number(row.expires_seconds) * 1_000, statusExpiresAtMs: Number(row.status_expires_ms),
    };
    if (row.state === null) return { ...metadata, state: 'issued' };
    const result = row.ciphertext instanceof Uint8Array
      ? { bytes: row.ciphertext, expiresAtMs: Number(row.result_expires_ms) } : undefined;
    return { ...metadata, state: row.state as GenerationState, settledOrReserved: String(row.amount), result };
  }

  settleKnown(ticket: VerifiedGenerationTicket, state: 'succeeded' | 'failed', actualMicrousd: bigint, result?: RetainedResult): boolean {
    if (typeof actualMicrousd !== 'bigint' || actualMicrousd < 0n) throw new RangeError('Invalid known provider cost.');
    if (result && (state !== 'succeeded' || !(result.bytes instanceof Uint8Array) ||
        result.bytes.length <= 28 || result.bytes.length > maxSealedResultBytes ||
        !Number.isSafeInteger(result.completedAtMs) || !Number.isSafeInteger(result.completedAtMs + resultLifetimeMs))) {
      throw new RangeError('Invalid retained proposal result.');
    }
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT day, started_ms, CAST(amount AS TEXT) AS amount FROM generations
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
      if (result) {
        if (result.completedAtMs < Number(row.started_ms)) throw new RangeError('Invalid result completion time.');
        this.db.prepare('INSERT INTO proposal_results (ticket_id, expires_ms, ciphertext) VALUES (?, ?, ?)')
          .run(ticket.jti, result.completedAtMs + resultLifetimeMs, result.bytes);
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
