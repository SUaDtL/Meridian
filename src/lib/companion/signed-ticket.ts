import { Buffer } from 'node:buffer';
import { assistRequestTimestamp } from '../authoring/assist-request-id';
import { decodeJson } from '../authoring/decode-json';
import { checkRequestClock, checkTicketClock } from './admission-clock';
import { agreedCharge, type ChargeAcknowledgment, type PricePolicy } from './price-policy';

const audience = 'meridian-assistant-generate/v1';
const format = 'm1';
const keyIdFormat = /^[a-zA-Z0-9_-]{1,64}$/;
const digestFormat = /^[0-9a-f]{64}$/;
const ticketIdFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const amountFormat = /^(?:0|[1-9][0-9]{0,14})$/;
const encodingFormat = /^[a-zA-Z0-9_-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type TicketClaims = Readonly<{
  version: 1;
  jti: string;
  subjectBinding: string;
  requestId: string;
  requestHash: string;
  iat: number;
  exp: number;
  aud: typeof audience;
  pricePolicyVersion: string;
  maxChargeMicrousd: string;
}>;

type SigningKey = { id: string; key: CryptoKey };
type TicketRequest = ChargeAcknowledgment & { requestId: string; requestHash: string };

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function isTicketKey(key: CryptoKey | undefined, usage: 'sign' | 'verify'): key is CryptoKey {
  const algorithm = key?.algorithm as HmacKeyAlgorithm | undefined;
  return key?.type === 'secret' && algorithm?.name === 'HMAC' && algorithm.hash.name === 'SHA-256' &&
    Number.isSafeInteger(algorithm.length) && algorithm.length >= 256 && key.usages.includes(usage);
}

function claimTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeClaims(encoded: string): TicketClaims | undefined {
  let decoded: unknown;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return undefined;
    decoded = decodeJson(decoder.decode(bytes), 12);
  } catch { return undefined; }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded) || Object.keys(decoded).length !== 10) return undefined;
  const value = decoded as Record<string, unknown>;
  if (value.version !== 1 || value.aud !== audience || !matches(value.jti, ticketIdFormat) ||
      !matches(value.subjectBinding, digestFormat) || !matches(value.requestHash, digestFormat) ||
      typeof value.requestId !== 'string' || assistRequestTimestamp(value.requestId) === undefined ||
      !claimTime(value.iat) || !claimTime(value.exp) || typeof value.pricePolicyVersion !== 'string' ||
      value.pricePolicyVersion.length === 0 || Array.from(value.pricePolicyVersion).length > 80 ||
      decoder.decode(encoder.encode(value.pricePolicyVersion)) !== value.pricePolicyVersion ||
      !matches(value.maxChargeMicrousd, amountFormat)) return undefined;
  return Object.freeze({
    version: 1, aud: audience, jti: value.jti, subjectBinding: value.subjectBinding, requestId: value.requestId,
    requestHash: value.requestHash, iat: value.iat, exp: value.exp, pricePolicyVersion: value.pricePolicyVersion,
    maxChargeMicrousd: value.maxChargeMicrousd,
  });
}

export async function signCompanionTicket(
  request: TicketRequest,
  subjectBinding: string,
  signing: SigningKey,
  policy: PricePolicy,
  nowMs: number,
) {
  const clock = checkRequestClock(request.requestId, nowMs);
  if (clock.code !== 'ELIGIBLE') return { code: clock.code };
  if (!matches(request.requestHash, digestFormat)) return { code: 'INVALID_REQUEST' as const };
  if (!matches(subjectBinding, digestFormat) || !matches(signing.id, keyIdFormat) || !isTicketKey(signing.key, 'sign')) {
    throw new Error('Invalid companion signing configuration.');
  }
  const agreement = agreedCharge(policy, request);
  if (agreement.code !== 'ACCEPTED') return agreement;
  const iat = Math.floor(nowMs / 1000);
  const claims: TicketClaims = {
    version: 1, aud: audience, jti: crypto.randomUUID(), subjectBinding, requestId: request.requestId,
    requestHash: request.requestHash, iat, exp: iat + 900, pricePolicyVersion: policy.version,
    maxChargeMicrousd: agreement.reserveMicrousd.toString(),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  if (!decodeClaims(payload)) throw new Error('Invalid companion ticket claims.');
  const signed = `${format}.${signing.id}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', signing.key, encoder.encode(signed));
  const ticket = `${signed}.${Buffer.from(signature).toString('base64url')}`;
  return { code: 'SIGNED' as const, ticket, claims: Object.freeze(claims) };
}

export async function verifyCompanionTicket(
  encodedTicket: string,
  subjectBinding: string,
  verificationKeys: ReadonlyMap<string, CryptoKey>,
  nowMs: number,
) {
  const invalid = { code: 'TICKET_INVALID' as const };
  if (encodedTicket.length < 16 || encodedTicket.length > 2048 || !matches(subjectBinding, digestFormat)) return invalid;
  const parts = encodedTicket.split('.');
  if (parts.length !== 4) return invalid;
  const [version, keyId, payload, signature] = parts;
  if (version !== format || !matches(keyId, keyIdFormat) || !matches(payload, encodingFormat) ||
      signature.length !== 43 || !matches(signature, encodingFormat)) return invalid;
  const key = verificationKeys.get(keyId);
  if (!isTicketKey(key, 'verify')) return invalid;
  const bytes = Buffer.from(signature, 'base64url');
  if (bytes.toString('base64url') !== signature || bytes.length !== 32) return invalid;
  const signed = encoder.encode(`${version}.${keyId}.${payload}`);
  if (!await crypto.subtle.verify('HMAC', key, bytes, signed)) return invalid;

  const claims = decodeClaims(payload);
  if (!claims || claims.subjectBinding !== subjectBinding) return invalid;
  const request = checkRequestClock(claims.requestId, nowMs);
  if (request.code !== 'ELIGIBLE') return { code: request.code };
  const ticket = checkTicketClock(claims.iat, claims.exp, nowMs);
  return ticket === 'ELIGIBLE' ? { code: 'VERIFIED' as const, claims } : { code: ticket };
}
