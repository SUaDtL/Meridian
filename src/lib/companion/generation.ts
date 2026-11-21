import { assistFileLimit } from '../authoring/assist-exchange';
import { validateCompanionOperations } from './operations';
import { knownCharge, priceCeiling, type PricePolicy, type ProviderUsage } from './price-policy';
import { parseCompanionRequest, type CompanionRequest } from './request';
import type { CompanionAdmissionLedger } from './serial-admission';
import { verifyCompanionTicket } from './signed-ticket';

const deadlineMs = 25_000;
const nonceBytes = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

type ProviderInput = Pick<CompanionRequest, 'instruction' | 'graph' | 'scope' | 'allowedOperations'>;
type ProviderLimits = Pick<PricePolicy, 'maxInputTokens' | 'maxOutputTokens'>;
type ProviderOutcome = { kind: 'completed'; operations: string; usage: ProviderUsage }
  | { kind: 'failed'; usage: ProviderUsage };
type Provider = (input: ProviderInput, limits: ProviderLimits, signal: AbortSignal) => Promise<ProviderOutcome>;

function resultBinding(subject: string, requestId: string) {
  return encoder.encode(JSON.stringify(['meridian-assist-result/v1', subject, requestId]));
}

async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>, subject: string, requestId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(nonceBytes));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: resultBinding(subject, requestId) }, key, data);
  const blob = new Uint8Array(iv.length + ciphertext.byteLength);
  blob.set(iv);
  blob.set(new Uint8Array(ciphertext), iv.length);
  return blob;
}

async function unseal(key: CryptoKey, blob: Uint8Array, subject: string, requestId: string) {
  const bytes = Uint8Array.from(blob);
  const iv = bytes.subarray(0, nonceBytes);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: resultBinding(subject, requestId) },
    key, bytes.subarray(nonceBytes));
  return decoder.decode(plaintext);
}

/** Local generation reference. Its caller supplies an authenticated subject and an approved provider adapter.
 *  This class exposes no HTTP handlers and does not implement session or CSRF verification. */
export class CompanionGeneration {
  constructor(
    private readonly ledger: CompanionAdmissionLedger,
    private readonly verificationKeys: ReadonlyMap<string, CryptoKey>,
    private readonly resultKey: CryptoKey,
    private readonly pricePolicy: PricePolicy,
    private readonly provider: Provider,
    private readonly now = Date.now,
  ) {
    priceCeiling(pricePolicy);
    if (resultKey.type !== 'secret' || resultKey.extractable || resultKey.algorithm.name !== 'AES-GCM' ||
        (resultKey.algorithm as AesKeyAlgorithm).length !== 256 ||
        !resultKey.usages.includes('encrypt') || !resultKey.usages.includes('decrypt')) {
      throw new Error('Configure a non-exportable AES-256-GCM companion result key.');
    }
  }

  async status(subject: string, requestId: string) {
    const now = this.now();
    const record = this.ledger.status(subject, requestId, now);
    if (record.code === 'ISSUED' && record.ticketExpiresAtMs <= now) return { code: 'TICKET_EXPIRED' as const };
    if (record.code !== 'STATUS') return record;
    const amountMicrousd = record.amount.toString();
    if (record.state !== 'succeeded') return { code: 'STATUS' as const, state: record.state, amountMicrousd };
    if (!record.sealedResult) return { code: 'RESULT_EXPIRED' as const, amountMicrousd };
    try {
      const proposal = await unseal(this.resultKey, record.sealedResult, subject, requestId);
      return { code: 'STATUS' as const, state: 'succeeded' as const, amountMicrousd, proposal };
    } catch { return { code: 'RESULT_UNAVAILABLE' as const, amountMicrousd }; }
  }

  /** Read the authenticated owner's local status and cost without invoking the provider. */
  async readRequestStatus(subject: string, requestId: string) {
    const now = this.now();
    const serverTime = new Date(now).toISOString();
    const record = this.ledger.ownedGeneration(subject, requestId, now);
    if (!record) return {
      status: 404 as const,
      body: { code: 'REQUEST_NOT_FOUND', message: 'This request is unavailable.', retryable: false, serverTime },
    };
    const state = record.state === 'issued' && record.ticketExpiresAtMs <= now ? 'expired' : record.state;
    const costStatus = record.state === 'issued' ? 'no_charge'
      : record.state === 'running' ? 'reserved' : record.state === 'uncertain' ? 'reserved_unknown' : 'settled_known';
    const cost = {
      currency: 'USD' as const, unit: 'microdollar' as const, pricePolicyVersion: record.policyVersion,
      reservedMicrousd: record.state === 'issued' ? '0' : record.maximumCharge,
      settledMicrousd: record.state === 'issued' ? '0' : record.state === 'running' || record.state === 'uncertain'
        ? null : record.settledOrReserved,
      costStatus,
    };
    const body = { requestId, requestHash: record.requestHash, state, serverTime,
      statusExpiresAt: new Date(record.statusExpiresAtMs).toISOString(), resultAvailable: false, cost };
    if (record.state !== 'succeeded') return { status: 200 as const, body };
    if (!record.result) return {
      status: 410 as const,
      body: { code: 'RESULT_EXPIRED', message: 'The proposal download expired.', requestId, retryable: false, serverTime, state, cost },
    };
    try {
      const proposal = JSON.parse(await unseal(this.resultKey, record.result.bytes, subject, requestId)) as unknown;
      return { status: 200 as const, body: { ...body, resultAvailable: true,
        resultExpiresAt: new Date(record.result.expiresAtMs).toISOString(), proposal } };
    } catch {
      return { status: 503 as const,
        body: { code: 'LEDGER_UNAVAILABLE', message: 'The saved proposal could not be read.', retryable: false, serverTime } };
    }
  }

  async generate(subject: string, ticket: string, idempotencyKey: string, bytes: Uint8Array) {
    const verified = await verifyCompanionTicket(ticket, subject, this.verificationKeys, this.now());
    if (verified.code !== 'VERIFIED') return verified;
    const { claims } = verified;
    if (idempotencyKey !== claims.requestId) return { code: 'IDEMPOTENCY_CONFLICT' as const };
    let parsed: Awaited<ReturnType<typeof parseCompanionRequest>>;
    try {
      parsed = await parseCompanionRequest(bytes);
    } catch { return { code: 'INVALID_REQUEST' as const }; }

    const { request, requestHash } = parsed;
    if (request.requestId !== idempotencyKey) return { code: 'IDEMPOTENCY_CONFLICT' as const };
    const now = this.now();
    this.ledger.pruneExpired(now);
    this.ledger.reconcileAbandoned(now);
    const reserved = this.ledger.reserve(claims, request.requestId, requestHash, now);
    if (reserved.code === 'EXISTING') return this.status(subject, idempotencyKey);
    if (reserved.code !== 'RESERVED') return reserved;

    try {
      const outcome = await this.invoke(request);
      const actual = knownCharge(this.pricePolicy, outcome.usage);
      if (outcome.kind === 'completed') {
        let result: Awaited<ReturnType<typeof seal>> | undefined;
        try {
          const operations = validateCompanionOperations(outcome.operations, request);
          const proposal = encoder.encode(JSON.stringify({
            schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
            baseToken: request.baseToken, requestId: request.requestId, requestHash, operations,
          }));
          if (proposal.byteLength <= assistFileLimit) result = await seal(this.resultKey, proposal, subject, idempotencyKey);
        } catch { /* Known provider usage still settles when its output cannot be returned. */ }
        if (result) {
          this.ledger.settleKnown(claims, 'succeeded', actual, { bytes: result, completedAtMs: this.now() });
        } else {
          this.ledger.settleKnown(claims, 'failed', actual);
        }
      } else {
        this.ledger.settleKnown(claims, 'failed', actual);
      }
    } catch {
      this.ledger.markUncertain(claims);
    }
    return this.status(subject, idempotencyKey);
  }

  cleanup() {
    const now = this.now();
    this.ledger.reconcileAbandoned(now);
    this.ledger.pruneExpired(now);
  }

  private async invoke(request: CompanionRequest) {
    const { instruction, graph, scope, allowedOperations } = request;
    const { maxInputTokens, maxOutputTokens } = this.pricePolicy;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('Companion generation deadline exceeded.'));
        controller.abort();
      }, deadlineMs);
    });
    try {
      return await Promise.race([
        deadline,
        this.provider(structuredClone({ instruction, graph, scope, allowedOperations }),
          { maxInputTokens, maxOutputTokens }, controller.signal),
      ]);
    } finally { clearTimeout(timeout); }
  }
}
