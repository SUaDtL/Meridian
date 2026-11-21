export const renderMemoryLimit = 32 * 1024 * 1024;
export type RenderRetention = 'optional' | 'selected' | 'foreground';
type MemoryPart = string | { object: object; bytes: number };
type PartKey = object | string;

export type RenderFootprint = { parts: readonly MemoryPart[]; privateBytes?: number };
type Entry = {
  parts: Map<PartKey, number>;
  privateBytes: number;
  priority: RenderRetention;
  onEvict: () => void;
};
export type RenderReservation = {
  touch: (priority?: RenderRetention) => void;
  release: () => void;
};

const rank: Record<RenderRetention, number> = { optional: 0, selected: 1, foreground: 2 };

function weightedParts(parts: readonly MemoryPart[]) {
  const weights = new Map<PartKey, number>();
  for (const part of parts) {
    const key = typeof part === 'string' ? part : part.object;
    const bytes = typeof part === 'string' ? part.length * 2 : Math.max(0, part.bytes);
    weights.set(key, Math.max(bytes, weights.get(key) ?? 0));
  }
  return weights;
}

/** Shared estimated string and model storage. Browser DOM and live frames are outside these caches. */
export class RenderMemoryBudget {
  private entries = new Set<Entry>();
  private references = new Map<PartKey, { count: number; bytes: number }>();
  private bytes = 0;

  constructor(private readonly limit: number) {}

  estimatedBytes() { return this.bytes; }

  reserve(footprint: RenderFootprint, priority: RenderRetention, onEvict: () => void): RenderReservation | undefined {
    const entry: Entry = {
      parts: weightedParts(footprint.parts), privateBytes: Math.max(0, footprint.privateBytes ?? 0), priority, onEvict,
    };
    let total = this.bytes + entry.privateBytes;
    for (const [part, bytes] of entry.parts) total += Math.max(0, bytes - (this.references.get(part)?.bytes ?? 0));
    if (total > this.limit && !this.fitsAlongsideHigherPriority(entry)) return undefined;

    this.entries.add(entry);
    this.bytes = total;
    for (const [part, bytes] of entry.parts) {
      const reference = this.references.get(part);
      if (reference) {
        reference.count++;
        reference.bytes = Math.max(reference.bytes, bytes);
      } else this.references.set(part, { count: 1, bytes });
    }

    const evicted: Entry[] = [];
    while (this.bytes > this.limit) {
      let victim: Entry | undefined;
      for (const other of this.entries) {
        if (other === entry || rank[other.priority] > rank[entry.priority]) continue;
        if (!victim || rank[other.priority] < rank[victim.priority]) victim = other;
      }
      // The admission check established that the new and protected entries fit.
      if (!victim) throw new Error('Render cache accounting became inconsistent.');
      this.release(victim);
      evicted.push(victim);
    }
    for (const victim of evicted) victim.onEvict();
    return {
      touch: nextPriority => {
        if (!this.entries.delete(entry)) return;
        if (nextPriority) entry.priority = nextPriority;
        this.entries.add(entry);
      },
      release: () => this.release(entry),
    };
  }

  private fitsAlongsideHigherPriority(candidate: Entry) {
    const parts = new Map(candidate.parts);
    let total = candidate.privateBytes;
    for (const entry of this.entries) {
      if (rank[entry.priority] <= rank[candidate.priority]) continue;
      total += entry.privateBytes;
      for (const [part, bytes] of entry.parts) parts.set(part, Math.max(bytes, parts.get(part) ?? 0));
    }
    for (const bytes of parts.values()) total += bytes;
    return total <= this.limit;
  }

  private release(entry: Entry) {
    if (!this.entries.delete(entry)) return;
    this.bytes -= entry.privateBytes;
    for (const [part, bytes] of entry.parts) {
      const reference = this.references.get(part)!;
      if (--reference.count === 0) {
        this.bytes -= reference.bytes;
        this.references.delete(part);
      } else if (bytes === reference.bytes) {
        let retained = 0;
        for (const remaining of this.entries) retained = Math.max(retained, remaining.parts.get(part) ?? 0);
        this.bytes -= reference.bytes - retained;
        reference.bytes = retained;
      }
    }
  }
}

export const renderMemoryBudget = new RenderMemoryBudget(renderMemoryLimit);

type CacheEntry<T> = { value: T; bytes: number; priority: RenderRetention; reservation?: RenderReservation };

/** LRU cache with entry and byte limits, optionally backed by a shared renderer budget. */
export class RenderCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;

  constructor(private maxEntries: number, private maxBytes: number, private memory?: RenderMemoryBudget) {}

  get(key: string, priority?: RenderRetention): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.touch(key, entry, priority);
    return entry.value;
  }

  prioritize(key: string, priority: RenderRetention) {
    const entry = this.entries.get(key);
    if (entry) this.touch(key, entry, priority);
  }

  set(key: string, value: T, footprint: number | RenderFootprint, priority: RenderRetention = 'optional'): void {
    this.remove(key);
    const parts = [key, ...(typeof footprint === 'number' ? [] : footprint.parts)];
    const privateBytes = Math.max(0, typeof footprint === 'number' ? footprint : footprint.privateBytes ?? 0);
    let bytes = privateBytes;
    for (const partBytes of weightedParts(parts).values()) bytes += partBytes;
    if (bytes > this.maxBytes || this.maxEntries < 1) return;

    const entry: CacheEntry<T> = { value, bytes, priority };
    entry.reservation = this.memory?.reserve({ parts, privateBytes }, priority, () => {
      if (this.entries.get(key) === entry) this.remove(key);
    });
    if (this.memory && !entry.reservation) return;

    this.entries.set(key, entry);
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      let oldest: [string, CacheEntry<T>] | undefined;
      for (const candidate of this.entries) {
        if (!oldest || rank[candidate[1].priority] < rank[oldest[1].priority]) oldest = candidate;
      }
      if (!oldest) break;
      this.remove(oldest[0]);
    }
  }

  private touch(key: string, entry: CacheEntry<T>, priority?: RenderRetention) {
    if (priority) entry.priority = priority;
    entry.reservation?.touch(priority);
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    entry.reservation?.release();
  }
}
