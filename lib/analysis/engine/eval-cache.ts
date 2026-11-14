// lib/analysis/engine/eval-cache.ts
// In-memory LRU cache implementing EvalCache interface.
//
// Per architect review Finding 6:
// - On cache hit, return a NEW PVRecord with the caller's rootId
//   (never return the stored object with its original rootId).
// - Incomplete searches are NOT cached.
// - Key includes search budget, not just FEN.
// - Config hash captures engine identity + options.

import type {
  EvalCacheKey,
  EvalCache,
  PVRecord,
  SearchBudget,
} from "../core/types.ts";

interface Entry {
  readonly key: string;
  readonly pv: PVRecord;
  readonly storedAt: number;
}

const DEFAULT_CAPACITY = 256;

function serializeKey(key: EvalCacheKey): string {
  const b = key.searchBudget;
  // Deterministic, order-stable. Budget kind included so depth≠movetime≠nodes.
  return [
    `fen=${key.fen}`,
    `eng=${key.engineIdentity}`,
    `cfg=${key.configHash}`,
    `budget=${b.kind}:${b.value}`,
    `mpv=${key.multiPv}`,
    `model=${key.evaluationModelVersion}`,
  ].join("|");
}

export class LRUEvalCache implements EvalCache {
  private readonly capacity: number;
  private readonly store = new Map<string, Entry>(); // insertion order = LRU order
  private hits = 0;
  private misses = 0;

  constructor(capacity = DEFAULT_CAPACITY) {
    if (capacity <= 0) throw new Error("LRUEvalCache: capacity must be > 0");
    this.capacity = capacity;
  }

  /**
   * Lookup by key. Returns null on miss.
   * IMPORTANT: The returned PVRecord is a COPY with the CALLER's rootId.
   * The caller supplies the new rootId via `set()` side-channel — but
   * here we don't know the caller's rootId. Instead, callers must call
   * `getWithRoot(key, newRootId)` for correct provenance.
   */
  get(key: EvalCacheKey): PVRecord | null {
    const k = serializeKey(key);
    const entry = this.store.get(k);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    // Move to end (most recently used)
    this.store.delete(k);
    this.store.set(k, entry);
    this.hits += 1;
    return entry.pv;
  }

  /**
   * Lookup by key AND rebind to a new rootId.
   * This is the correct method to use when returning a cached PV to a
   * caller that has just created a new AnalysisRoot. Without rebinding,
   * validatePV() would fail (pv.rootId !== root.id).
   */
  getWithRoot(key: EvalCacheKey, newRootId: string, newPvId: string): PVRecord | null {
    const cached = this.get(key);
    if (!cached) return null;
    // Return a NEW object with the caller's rootId. Do NOT mutate the stored one.
    return {
      ...cached,
      id: newPvId,
      rootId: newRootId,
    };
  }

  set(key: EvalCacheKey, pv: PVRecord): void {
    const k = serializeKey(key);
    if (this.store.has(k)) this.store.delete(k);
    this.store.set(k, { key: k, pv, storedAt: Date.now() });
    if (this.store.size > this.capacity) {
      // Evict least recently used (first insertion)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  invalidate(key: EvalCacheKey): void {
    this.store.delete(serializeKey(key));
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { readonly hits: number; readonly misses: number; readonly size: number } {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }
}

/**
 * Convenience: build a cache key from the ingredients.
 */
export function makeEvalCacheKey(args: {
  fen: string;
  engineIdentity: string;
  configHash: string;
  searchBudget: SearchBudget;
  multiPv: number;
  evaluationModelVersion: string;
}): EvalCacheKey {
  return {
    fen: args.fen,
    engineIdentity: args.engineIdentity,
    configHash: args.configHash,
    searchBudget: args.searchBudget,
    multiPv: args.multiPv,
    evaluationModelVersion: args.evaluationModelVersion,
  };
}
