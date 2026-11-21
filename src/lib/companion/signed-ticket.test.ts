import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { PricePolicy } from './price-policy';
import { signCompanionTicket, verifyCompanionTicket } from './signed-ticket';

const now = Date.parse('2026-11-20T07:00:00Z');
const subject = '1'.repeat(64);
const otherSubject = '2'.repeat(64);
const requestHash = 'a'.repeat(64);
const policy: PricePolicy = {
  version: 'example-tariff.v1', currency: 'USD', unit: 'microdollar', maxInputTokens: 1, maxOutputTokens: 1,
  inputMicrousdPerMillionTokens: '1000000', outputMicrousdPerMillionTokens: '2000000',
  fixedUpperBoundMicrousd: '0', maxChargeMicrousd: '3', displayLabel: 'Test price',
};

function requestAt(at = now) {
  const time = at.toString(16).padStart(12, '0');
  return {
    requestId: `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-000000000001`,
    requestHash, acknowledgeBillableRequest: true, pricePolicyVersion: policy.version,
    acknowledgedMaxChargeMicrousd: policy.maxChargeMicrousd,
  };
}

function signingKey(length = 256) {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length }, false, ['sign', 'verify']);
}

async function signedTestPayload(id: string, key: CryptoKey, content: string) {
  const encoded = Buffer.from(content).toString('base64url');
  const signed = `m1.${id}.${encoded}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  return `${signed}.${Buffer.from(signature).toString('base64url')}`;
}

describe('local signed companion ticket', () => {
  it('binds UUID, price, digest and exact subject for the 15-minute lifetime', async () => {
    const key = await signingKey();
    const request = requestAt();
    const result = await signCompanionTicket(request, subject, { id: 'key-2026', key }, policy, now);
    if (result.code !== 'SIGNED') throw new Error('Missing signed fixture ticket.');
    const keys = new Map([['key-2026', key]]);
    expect(result.claims.jti).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(result.claims).toMatchObject({
      version: 1, subjectBinding: subject, requestId: request.requestId, requestHash, aud: 'meridian-assistant-generate/v1',
      iat: now / 1000, exp: now / 1000 + 900, pricePolicyVersion: policy.version, maxChargeMicrousd: '3',
    });
    expect(await verifyCompanionTicket(result.ticket, subject, keys, now + 899_999)).toEqual({
      code: 'VERIFIED', claims: result.claims,
    });
    expect(await verifyCompanionTicket(result.ticket, subject, keys, now + 900_000)).toEqual({ code: 'TICKET_EXPIRED' });
    expect(await verifyCompanionTicket(result.ticket, otherSubject, keys, now)).toEqual({ code: 'TICKET_INVALID' });
  });

  it('checks skew, age, explicit consent and exact price before issuing a ticket', async () => {
    const key = await signingKey();
    const issue = (request: ReturnType<typeof requestAt>) => signCompanionTicket(request, subject, { id: 'key', key }, policy, now);
    expect(await issue(requestAt(now + 300_000))).toMatchObject({ code: 'SIGNED' });
    expect(await issue(requestAt(now + 300_001))).toEqual({ code: 'REQUEST_CLOCK_SKEW' });
    expect(await issue(requestAt(now - 86_400_000))).toEqual({ code: 'REQUEST_EXPIRED' });
    expect(await issue({ ...requestAt(), acknowledgeBillableRequest: false })).toEqual({ code: 'INVALID_REQUEST' });
    expect(await issue({ ...requestAt(), acknowledgedMaxChargeMicrousd: '4' })).toEqual({ code: 'PRICE_POLICY_CHANGED' });
    expect(await issue({ ...requestAt(), requestHash: requestHash + '0' })).toEqual({ code: 'INVALID_REQUEST' });
    const weak = await signingKey(128);
    await expect(signCompanionTicket(requestAt(), subject, { id: 'weak', key: weak }, policy, now))
      .rejects.toThrow('Invalid companion signing configuration.');
  });

  it('restricts verification to active allowed keys and the fixed authenticated format', async () => {
    const [previous, current] = await Promise.all([signingKey(), signingKey()]);
    const result = await signCompanionTicket(requestAt(), subject, { id: 'previous', key: previous }, policy, now);
    if (result.code !== 'SIGNED') throw new Error('Missing signed rotation fixture.');
    const rotating = new Map([['previous', previous], ['current', current]]);
    const retired = new Map([['current', current]]);
    expect(await verifyCompanionTicket(result.ticket, subject, rotating, now)).toMatchObject({ code: 'VERIFIED' });
    expect(await verifyCompanionTicket(result.ticket, subject, retired, now)).toEqual({ code: 'TICKET_INVALID' });
    const [version, keyId, payload, signature] = result.ticket.split('.');
    for (const token of [
      `none.${keyId}.${payload}.${signature}`, `${version}.current.${payload}.${signature}`,
      `${version}.${keyId}.${Buffer.from('changed').toString('base64url')}.${signature}`,
      result.ticket + '=', 'x'.repeat(2049),
    ]) {
      expect(await verifyCompanionTicket(token, subject, rotating, now)).toEqual({ code: 'TICKET_INVALID' });
    }
  });

  it('refuses structurally invalid claims even with a configured signature', async () => {
    const key = await signingKey();
    const result = await signCompanionTicket(requestAt(), subject, { id: 'active', key }, policy, now);
    if (result.code !== 'SIGNED') throw new Error('Missing valid fixture claims.');
    const keys = new Map([['active', key]]);
    const claims = JSON.stringify(result.claims);
    for (const payload of [
      claims.replace('"version":1', '"version":1,"version":1'),
      JSON.stringify({ ...result.claims, aud: 'other-audience' }),
      JSON.stringify({ ...result.claims, exp: result.claims.exp + 1 }),
      JSON.stringify({ ...result.claims, maxChargeMicrousd: '03' }),
      JSON.stringify({ ...result.claims, unknown: true }),
    ]) {
      const ticket = await signedTestPayload('active', key, payload);
      expect(await verifyCompanionTicket(ticket, subject, keys, now)).toEqual({ code: 'TICKET_INVALID' });
    }
  });
});
