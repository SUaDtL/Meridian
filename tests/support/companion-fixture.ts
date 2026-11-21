import { CompanionGeneration } from '../../src/lib/companion/generation';
import { issueCompanionTicket } from '../../src/lib/companion/issue-ticket';
import { createLocalCompanionApi } from '../../src/lib/companion/local-api';
import { CompanionAdmissionLedger } from '../../src/lib/companion/serial-admission';
import { parseCompanionRequest } from '../../src/lib/companion/request';

const subject = 'a'.repeat(64);
const csrf = 'b'.repeat(48);
export const policy = {
  version: 'local-test.v1', currency: 'USD' as const, unit: 'microdollar' as const,
  maxInputTokens: 10, maxOutputTokens: 12, inputMicrousdPerMillionTokens: '1000000',
  outputMicrousdPerMillionTokens: '2000000', fixedUpperBoundMicrousd: '4',
  maxChargeMicrousd: '38', displayLabel: 'Local fixture',
};
const node = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const neighbor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const operation = { op: 'setNodeLabel', targetId: node, label: 'Reviewed label' };

export async function companionFixture(origin: string) {
  const now = Date.now;
  const time = now();
  const timestamp = time.toString(16).padStart(12, '0');
  const request = {
    schema: 'meridian/assist-request/v1', documentKind: 'mermaid',
    requestId: `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7000-8000-000000000001`,
    baseToken: { projectId: '11111111-1111-4111-8111-111111111111', revision: 1,
      contentHash: 'd'.repeat(64), stateDigest: 'e'.repeat(64) },
    instruction: 'Rename only the writable node.',
    scope: { readContextIds: [node, neighbor], writableElementIds: [node], attachmentPointIds: [] },
    graph: { nodes: [node, neighbor].map(id => ({
      id, elementKind: 'node', label: 'Service', parentGroupId: null, shape: 'rect', incidentEdgesComplete: false,
    })), edges: [], groups: [] },
    allowedOperations: ['setNodeLabel'],
  };
  const bytes = Buffer.from(JSON.stringify(request));
  const { requestHash } = await parseCompanionRequest(bytes);
  const ledger = new CompanionAdmissionLedger(':memory:', { pricePolicy: policy, dailySubjectMicrousd: 38n, dailyGlobalMicrousd: 38n });
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  const keys = new Map([['fixture', key]]);
  const resultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  let done!: () => void;
  const release = new Promise<void>(resolve => { done = resolve; });
  let completed!: () => void;
  const settled = new Promise<void>(resolve => { completed = resolve; });
  let providerCalls = 0;
  let signedIn = true;
  const generation = new CompanionGeneration(ledger, keys, resultKey, policy, async () => {
    providerCalls++;
    await release;
    return { kind: 'completed', operations: JSON.stringify([operation]), usage: { inputTokens: 2, outputTokens: 3, overheadMicrousd: '1' } };
  });
  const api = createLocalCompanionApi({
    origin, generation,
    issue: (ticket, owner, now) => issueCompanionTicket(ticket, owner, { key, id: 'fixture' }, keys, policy, ledger, now),
    async authenticate() {
      if (!signedIn) return null;
      return { subjectBinding: subject, csrfToken: csrf, serviceEnabled: true, disabledReason: null, modelLabel: 'Isolated model fixture',
        pricePolicy: policy, subjectAllowance: { remainingMicrousd: '38', resetsAt: new Date(time + 86_400_000).toISOString(),
          generationStartsPerMinute: 5, concurrentLimit: 2 }, globalCapacityAvailable: true,
        sessionIdleExpiresAt: new Date(time + 60_000).toISOString(), sessionAbsoluteExpiresAt: new Date(time + 60_000).toISOString() };
    },
    async logout() { signedIn = false; },
  });
  return { request, bytes, requestHash, api, done, completed, settled,
    providerCalls: () => providerCalls, close: () => ledger.close() };
}
