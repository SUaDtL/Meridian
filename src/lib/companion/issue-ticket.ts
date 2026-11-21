import { sealCompanionTicket, signCompanionTicket, type SigningKey, type TicketRequest } from './signed-ticket';
import type { CompanionAdmissionLedger } from './serial-admission';
import type { PricePolicy } from './price-policy';

export async function issueCompanionTicket(
  request: TicketRequest,
  subjectBinding: string,
  signing: SigningKey,
  activeSigningKeys: ReadonlyMap<string, CryptoKey>,
  policy: PricePolicy,
  ledger: CompanionAdmissionLedger,
  nowMs: number,
) {
  const candidate = await signCompanionTicket(request, subjectBinding, signing, policy, nowMs);
  if (candidate.code !== 'SIGNED') return candidate;
  const recorded = ledger.registerIssuance(candidate.claims, signing.id, nowMs);
  if (recorded.code === 'ISSUED') return { ...recorded, ticket: candidate.ticket };
  if (recorded.code !== 'EXISTING') return recorded;
  const key = recorded.keyId === signing.id ? signing.key : activeSigningKeys.get(recorded.keyId);
  if (!key) return { code: 'FRESH_REQUEST_REQUIRED' as const };
  const ticket = await sealCompanionTicket(recorded.claims, { id: recorded.keyId, key });
  return { ...recorded, ticket };
}
