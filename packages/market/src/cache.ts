/**
 * Raw pulls cache — stores provider responses with dates.
 * References/market-research.md §12: store raw pulls, link them.
 */

export interface CacheEntry<T = unknown> {
  provider: string;
  date: string; // YYYY-MM-DD
  data: T;
}

export class MarketCache {
  private entries: CacheEntry[] = [];

  add<T>(provider: string, date: string, data: T): void {
    this.entries.push({ provider, date, data });
  }

  getAll(): CacheEntry[] {
    return [...this.entries];
  }

  getByProvider(provider: string): CacheEntry[] {
    return this.entries.filter((e) => e.provider === provider);
  }

  clear(): void {
    this.entries = [];
  }

  toJSON(): CacheEntry[] {
    return this.getAll();
  }

  size(): number {
    return this.entries.length;
  }
}
