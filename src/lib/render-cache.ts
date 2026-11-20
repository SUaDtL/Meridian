/** Small LRU cache with both entry and byte budgets. Large diagrams never pin memory. */
export class RenderCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(private maxEntries: number, private maxBytes: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    // Include the key, which contains the source and can itself be substantial.
    const weight = Math.max(0, bytes) + key.length * 2;
    if (weight > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(key, { value, bytes: weight });
    this.bytes += weight;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
