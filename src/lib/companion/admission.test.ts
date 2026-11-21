import { describe, expect, it } from 'vitest';
import { checkRequestClock, checkTicketClock, requestRetention } from './admission-clock';
import { agreedCharge, priceCeiling, type PricePolicy } from './price-policy';

const issuedAtMs = Date.parse('2026-11-20T07:00:00Z');
const futureTimestampMs = Date.parse('2026-11-20T07:05:00Z');
const ticketExpiryMs = Date.parse('2026-11-20T07:15:00Z');
const statusExpiryMs = Date.parse('2026-11-21T07:00:00Z');
const tombstoneExpiryMs = Date.parse('2026-11-21T07:05:00Z');

function requestId(timestampMs: number): string {
  const hex = timestampMs.toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000001`;
}

describe('companion admission clock', () => {
  it('enforces the exact future clock and age boundaries for UUIDv7', () => {
    expect(checkRequestClock(requestId(futureTimestampMs), issuedAtMs)).toEqual({
      code: 'ELIGIBLE', requestTimestampMs: futureTimestampMs,
    });
    expect(checkRequestClock(requestId(futureTimestampMs + 1), issuedAtMs)).toEqual({ code: 'REQUEST_CLOCK_SKEW' });
    expect(checkRequestClock(requestId(issuedAtMs), statusExpiryMs - 1).code).toBe('ELIGIBLE');
    expect(checkRequestClock(requestId(issuedAtMs), statusExpiryMs).code).toBe('REQUEST_EXPIRED');
    expect(checkRequestClock(requestId(issuedAtMs).replace('-7000-', '-4000-'), issuedAtMs).code).toBe('INVALID_REQUEST');
    expect(checkRequestClock(requestId(issuedAtMs) + '\n', issuedAtMs).code).toBe('INVALID_REQUEST');
    expect(() => checkRequestClock(requestId(issuedAtMs), Number.NaN)).toThrow(RangeError);
  });

  it('keeps the replay horizon until the future-dated ID itself expires', () => {
    const id = requestId(futureTimestampMs);
    expect(requestRetention(id, issuedAtMs)).toEqual({
      code: 'ELIGIBLE', statusExpiresAtMs: statusExpiryMs, tombstoneExpiresAtMs: tombstoneExpiryMs,
    });
    expect(requestRetention(requestId(issuedAtMs - 1), issuedAtMs)).toEqual({
      code: 'ELIGIBLE', statusExpiresAtMs: statusExpiryMs, tombstoneExpiresAtMs: statusExpiryMs,
    });
    expect(requestRetention(requestId(futureTimestampMs + 1), issuedAtMs)).toEqual({ code: 'REQUEST_CLOCK_SKEW' });
    expect(checkRequestClock(id, statusExpiryMs).code).toBe('ELIGIBLE');
    expect(checkRequestClock(id, tombstoneExpiryMs - 1).code).toBe('ELIGIBLE');
    expect(checkRequestClock(id, tombstoneExpiryMs).code).toBe('REQUEST_EXPIRED');
  });

  it('expires fifteen-minute signed claims at the first matching Unix second', () => {
    const issuedSeconds = issuedAtMs / 1000;
    const expirySeconds = ticketExpiryMs / 1000;
    expect(checkTicketClock(issuedSeconds, expirySeconds, issuedAtMs - 1)).toBe('TICKET_INVALID');
    expect(checkTicketClock(issuedSeconds, expirySeconds + 1, issuedAtMs)).toBe('TICKET_INVALID');
    expect(checkTicketClock(issuedSeconds + 0.5, expirySeconds + 0.5, issuedAtMs)).toBe('TICKET_INVALID');
    expect(checkTicketClock(issuedSeconds, expirySeconds, ticketExpiryMs - 1)).toBe('ELIGIBLE');
    expect(checkTicketClock(issuedSeconds, expirySeconds, ticketExpiryMs)).toBe('TICKET_EXPIRED');
    expect(checkRequestClock(requestId(futureTimestampMs), ticketExpiryMs).code).toBe('ELIGIBLE');
  });
});

describe('companion price policy', () => {
  const tariff: PricePolicy = {
    version: 'design-fixture.v1',
    currency: 'USD',
    unit: 'microdollar',
    maxInputTokens: 32_768,
    maxOutputTokens: 4096,
    inputMicrousdPerMillionTokens: '1000000',
    outputMicrousdPerMillionTokens: '5000000',
    fixedUpperBoundMicrousd: '0',
    maxChargeMicrousd: '53248',
    displayLabel: 'Fictitious design tariff',
  };
  const consent = {
    acknowledgeBillableRequest: true,
    pricePolicyVersion: tariff.version,
    acknowledgedMaxChargeMicrousd: tariff.maxChargeMicrousd,
  };

  it('matches the design fixture and requires affirmative consent to its exact version and ceiling', () => {
    expect(priceCeiling(tariff)).toBe(53_248n);
    expect(agreedCharge(tariff, consent)).toEqual({ code: 'ACCEPTED', reserveMicrousd: 53_248n });
    expect(agreedCharge(tariff, { ...consent, acknowledgeBillableRequest: false })).toEqual({ code: 'INVALID_REQUEST' });
    expect(agreedCharge(tariff, { ...consent, pricePolicyVersion: 'old' })).toEqual({ code: 'PRICE_POLICY_CHANGED' });
    expect(agreedCharge(tariff, { ...consent, acknowledgedMaxChargeMicrousd: '53249' })).toEqual({ code: 'PRICE_POLICY_CHANGED' });
    expect(agreedCharge(tariff, { ...consent, acknowledgedMaxChargeMicrousd: '053248' })).toEqual({ code: 'PRICE_POLICY_CHANGED' });
  });

  it('rounds the total only once and preserves exact arithmetic above the safe-integer product range', () => {
    expect(priceCeiling({
      ...tariff,
      maxInputTokens: 1,
      maxOutputTokens: 1,
      inputMicrousdPerMillionTokens: '1',
      outputMicrousdPerMillionTokens: '1',
      fixedUpperBoundMicrousd: '7',
      maxChargeMicrousd: '8',
    })).toBe(8n);
    expect(priceCeiling({
      ...tariff,
      maxInputTokens: 131_072,
      maxOutputTokens: 16_384,
      inputMicrousdPerMillionTokens: '999999999999999',
      outputMicrousdPerMillionTokens: '999999999999999',
      fixedUpperBoundMicrousd: '1',
      maxChargeMicrousd: '147456000000001',
    })).toBe(147_456_000_000_001n);
  });

  it('fails closed on an unverifiable tariff or an overflowing money envelope', () => {
    for (const amount of ['-1', '01', '1e6', '0.5', '1000000\n', '1000000000000000']) {
      expect(() => priceCeiling({ ...tariff, inputMicrousdPerMillionTokens: amount })).toThrow(RangeError);
    }
    expect(() => priceCeiling({ ...tariff, maxOutputTokens: 16_385 })).toThrow(RangeError);
    expect(() => priceCeiling({ ...tariff, maxChargeMicrousd: '53247' })).toThrow(RangeError);
    expect(() => priceCeiling({ ...tariff, displayLabel: '' })).toThrow(RangeError);
    expect(() => priceCeiling({ ...tariff, fixedUpperBoundMicrousd: '999999999999999' })).toThrow(RangeError);
  });
});
