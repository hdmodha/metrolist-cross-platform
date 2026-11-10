/**
 * Tiny least-recently-used cache with a time-to-live. Time is always passed in by the caller, so the
 * cache has no hidden clock and is deterministic under test.
 */
export class LruTtlCache<V> {
  private readonly entries = new Map<string, { value: V; storedAt: number }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: { maxEntries: number; ttlMs: number }) {
    if (!(options.maxEntries >= 1) || !(options.ttlMs > 0)) {
      throw new RangeError('LruTtlCache needs maxEntries >= 1 and ttlMs > 0');
    }
    this.maxEntries = Math.floor(options.maxEntries);
    this.ttlMs = options.ttlMs;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, nowMs: number): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (nowMs - entry.storedAt >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    // Re-insert so Map iteration order tracks recency
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, nowMs: number): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, storedAt: nowMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
