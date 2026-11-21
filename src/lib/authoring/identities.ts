/** The semantic types and limits of meridian/v3 identity registry version 1. */
export type SourceIdentity =
  | { elementKind: 'node' | 'group'; binding: { type: 'source-id'; sourceId: string } }
  | { elementKind: 'edge'; binding:
      | { type: 'edge-id'; sourceId: string }
      | { type: 'legacy-edge'; sourceId: string; targetId: string; labelHash: string; occurrence: number; fingerprint: string }
    };

export type IdentityRecord = SourceIdentity & {
  id: string;
  status: 'resolved' | 'missing' | 'ambiguous' | 'retired';
};

export const MAX_LIVE_IDENTITIES = 2_000;
export const MAX_RETAINED_IDENTITY_RECORDS = 500;
export const elementUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function sourceBindingKey({ elementKind, binding }: SourceIdentity): string {
  return JSON.stringify(binding.type === 'legacy-edge'
    ? [elementKind, binding.type, binding.sourceId, binding.targetId, binding.labelHash, binding.occurrence, binding.fingerprint]
    : [elementKind, binding.type, binding.sourceId]);
}

/** Parallel implicit connectors can share an old v2 label and end-point key. */
function parallelKey(binding: Extract<SourceIdentity['binding'], { type: 'legacy-edge' }>): string {
  return JSON.stringify([binding.sourceId, binding.targetId, binding.labelHash]);
}

export class IdentityLimitError extends Error {
  constructor(
    readonly reason: 'annotation-limit' | 'project-size',
    message = 'The project exceeds its identity and retained annotation limits. Export a recovery copy before resolving annotations.',
  ) {
    super(message);
    this.name = 'IdentityLimitError';
  }
}

function enforceIdentityBudget(records: readonly IdentityRecord[], orphanCount: number) {
  const resolved = records.filter(record => record.status === 'resolved').length;
  if (records.length - resolved + orphanCount > MAX_RETAINED_IDENTITY_RECORDS) throw new IdentityLimitError('annotation-limit');
  if (resolved > MAX_LIVE_IDENTITIES) throw new IdentityLimitError('project-size');
}

/**
 * Reconcile one accepted structural snapshot. A null observation represents
 * invalid or incomplete source and leaves current identities untouched.
 */
export function reconcileIdentities(
  previous: readonly IdentityRecord[],
  observed: readonly SourceIdentity[] | null,
  referenced: ReadonlySet<string>,
  orphanCount: number,
  allocateId: () => string = () => crypto.randomUUID(),
): readonly IdentityRecord[] {
  if (observed === null) return previous;
  if (!Number.isSafeInteger(orphanCount) || orphanCount < 0) throw new Error('Invalid orphan count.');
  if (observed.length > MAX_LIVE_IDENTITIES) throw new IdentityLimitError('project-size', 'The structural snapshot has too many elements.');
  enforceIdentityBudget(previous, orphanCount);

  const ids = new Set<string>();
  const live = new Map<string, IdentityRecord>();
  for (const record of previous) {
    if (!elementUuidPattern.test(record.id) || ids.has(record.id)) throw new Error('The identity registry contains a duplicate or invalid ID.');
    ids.add(record.id);
    if (record.status !== 'resolved') continue;
    const key = sourceBindingKey(record);
    if (live.has(key)) throw new Error('Multiple live identities claim the same source binding.');
    live.set(key, record);
  }

  const current = new Map<string, SourceIdentity>();
  const parallel = new Map<string, number>();
  for (const element of observed) {
    const key = sourceBindingKey(element);
    if (current.has(key)) throw new Error('The source projection contains a duplicate binding.');
    current.set(key, element);
    if (element.binding.type === 'legacy-edge') {
      const signature = parallelKey(element.binding);
      parallel.set(signature, (parallel.get(signature) ?? 0) + 1);
    }
  }

  const ambiguous = (element: SourceIdentity) =>
    element.binding.type === 'legacy-edge' && (parallel.get(parallelKey(element.binding)) ?? 0) > 1;
  const next: IdentityRecord[] = [];
  for (const record of previous) {
    if (record.status === 'resolved' && current.has(sourceBindingKey(record)) && !ambiguous(record)) {
      next.push(record);
      current.delete(sourceBindingKey(record));
    } else if (record.status === 'missing' || record.status === 'ambiguous') {
      next.push(record);
    } else if (referenced.has(record.id)) {
      const status = record.status === 'resolved' && ambiguous(record) ? 'ambiguous' : 'retired';
      next.push(record.status === status ? record : { ...record, status });
    }
  }
  for (const element of current.values()) {
    if (ambiguous(element)) continue;
    if (element.binding.type === 'legacy-edge' && element.binding.occurrence !== 0) {
      throw new Error('The source projection cannot prove an implicit connector occurrence.');
    }
    const id = allocateId();
    if (!elementUuidPattern.test(id) || ids.has(id)) throw new Error('Could not allocate a unique element ID.');
    ids.add(id);
    const source: SourceIdentity = element.elementKind === 'edge'
      ? { elementKind: 'edge', binding: element.binding }
      : { elementKind: element.elementKind, binding: element.binding };
    next.push({ ...source, id, status: 'resolved' });
  }
  enforceIdentityBudget(next, orphanCount);
  return next;
}
