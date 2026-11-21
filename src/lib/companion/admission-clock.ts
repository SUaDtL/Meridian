import { assistRequestTimestamp } from '../authoring/assist-request-id';

const requestLifetimeMs = 24 * 60 * 60 * 1000;
const maxFutureOffsetMs = 5 * 60 * 1000;
const ticketLifetimeSeconds = 15 * 60;

export type RequestClock =
  | { code: 'INVALID_REQUEST' | 'REQUEST_CLOCK_SKEW' | 'REQUEST_EXPIRED' }
  | { code: 'ELIGIBLE'; requestTimestampMs: number };

export function checkRequestClock(requestId: string, nowMs: number): RequestClock {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid server clock');
  const requestTimestampMs = assistRequestTimestamp(requestId);
  if (requestTimestampMs === undefined) return { code: 'INVALID_REQUEST' };
  if (requestTimestampMs - nowMs > maxFutureOffsetMs) return { code: 'REQUEST_CLOCK_SKEW' };
  if (nowMs - requestTimestampMs >= requestLifetimeMs) return { code: 'REQUEST_EXPIRED' };
  return { code: 'ELIGIBLE', requestTimestampMs };
}

export function checkTicketClock(
  issuedAtSeconds: number,
  expiresAtSeconds: number,
  nowMs: number,
): 'ELIGIBLE' | 'TICKET_INVALID' | 'TICKET_EXPIRED' {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new RangeError('Invalid server clock');
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(issuedAtSeconds) || !Number.isSafeInteger(expiresAtSeconds) ||
      issuedAtSeconds < 0 || issuedAtSeconds > nowSeconds ||
      expiresAtSeconds - issuedAtSeconds !== ticketLifetimeSeconds) {
    return 'TICKET_INVALID';
  }
  return nowSeconds >= expiresAtSeconds ? 'TICKET_EXPIRED' : 'ELIGIBLE';
}

export function requestRetention(requestId: string, issuedAtMs: number) {
  const admission = checkRequestClock(requestId, issuedAtMs);
  if (admission.code !== 'ELIGIBLE') return admission;
  const statusExpiresAtMs = issuedAtMs + requestLifetimeMs;
  const tombstoneExpiresAtMs = Math.max(issuedAtMs, admission.requestTimestampMs) + requestLifetimeMs;
  if (!Number.isSafeInteger(tombstoneExpiresAtMs)) throw new RangeError('Invalid retention deadline');
  return { code: 'ELIGIBLE' as const, statusExpiresAtMs, tombstoneExpiresAtMs };
}
