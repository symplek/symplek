/**
 * @module weft-core/idempotency
 * @description Idempotency-key infrastructure preventing duplicate execution of
 *   side-effecting AgentUnit runs. Provides the config/store contracts, an
 *   in-memory store with TTL expiry, and the IDEMPOTENCY_VIOLATION error.
 * @blast_radius MEDIUM — wired into AgentUnit.run().
 * @status STABLE
 * @runtime node
 * @surface public
 * @rules @.claude/rules/patterns/029-file-header-contracts.md
 */

import { WeftError } from "./errors";
import type { TrackedResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG + STORE CONTRACTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Behaviour when an idempotency key has already been seen.
 * - `reject`: throw {@link IdempotencyError} (fail-closed; duplicate writes blocked)
 * - `return-cached`: return the previously stored {@link TrackedResult} unchanged
 */
export type IdempotencyStrategy = "reject" | "return-cached";

/**
 * Per-run idempotency configuration passed via `AgentUnit.run(ctx, { idempotency })`.
 *
 * @remarks
 * The `store` is optional and injectable — omit it to use the process-wide
 * {@link defaultIdempotencyStore}, or supply any {@link IdempotencyStore}
 * (e.g. a Redis/Convex-backed implementation) for distributed deduplication.
 */
export interface IdempotencyConfig {
  /** Stable key uniquely identifying this logical operation. */
  key: string;
  /** Time-to-live in milliseconds for the cached result. Omit for no expiry. */
  ttl?: number;
  /** What to do when the key already exists. */
  strategy: IdempotencyStrategy;
  /**
   * Store used to read/write the cached result.
   * @default {@link defaultIdempotencyStore}
   */
  store?: IdempotencyStore;
}

/**
 * Pluggable persistence contract for idempotency results.
 * Implementations must be safe to share across concurrent runs.
 */
export interface IdempotencyStore {
  /** Return the cached result for `key`, or `null` if absent/expired. */
  get(key: string): Promise<TrackedResult<any> | null>;
  /** Persist `result` under `key`, optionally expiring after `ttl` ms. */
  set(key: string, result: TrackedResult<any>, ttl?: number): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a `reject`-strategy run encounters an already-used idempotency key.
 * Carries the descriptive code `IDEMPOTENCY_VIOLATION`.
 */
export class IdempotencyError extends WeftError {
  /** The duplicate key that triggered the violation. */
  readonly key: string;

  constructor(key: string) {
    super({
      code: "IDEMPOTENCY_VIOLATION",
      why: `Idempotency key "${key}" has already been used — duplicate execution rejected.`,
      action:
        "Use a unique key, or set strategy: 'return-cached' to return the prior result.",
      context: { key },
    });
    this.name = "IdempotencyError";
    this.key = key;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORE
// ─────────────────────────────────────────────────────────────────────────────

interface StoredEntry {
  result: TrackedResult<any>;
  /** Absolute expiry epoch-ms, or undefined when the entry never expires. */
  expiresAt?: number;
  /** Active cleanup timer, cleared on overwrite/delete. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Map-based {@link IdempotencyStore} for single-process use.
 *
 * @remarks
 * TTL is enforced two ways for robustness: a `setTimeout` proactively evicts the
 * entry, and `get()` also checks the stored `expiresAt` so a result is never
 * returned past its TTL even if the timer has not yet fired (e.g. under fake
 * timers). The timer is `unref`'d so it never keeps the process alive.
 *
 * Defaults:
 * - `defaultTtlMs`: 1 hour (3_600_000 ms) — entries without an explicit TTL expire.
 * - `maxEntries`: 10_000 — LRU eviction when the limit is reached.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  /** Default TTL applied to entries when no explicit TTL is provided. */
  static readonly DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
  /** Maximum number of entries before LRU eviction kicks in. */
  static readonly DEFAULT_MAX_ENTRIES = 10_000;

  private readonly store = new Map<string, StoredEntry>();
  /** LRU tracking: insertion/access order (head = oldest, tail = newest). */
  private readonly lru: string[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = InMemoryIdempotencyStore.DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<TrackedResult<any> | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.delete(key);
      return null;
    }
    // Promote to LRU tail on access
    this.touchLru(key);
    return entry.result;
  }

  async set(
    key: string,
    result: TrackedResult<any>,
    ttl?: number,
  ): Promise<void> {
    // Clear any prior timer so an overwrite doesn't leak a pending eviction.
    const existing = this.store.get(key);
    if (existing?.timer) clearTimeout(existing.timer);

    // Use default TTL when none is provided (prevents unbounded storage).
    const effectiveTtl = ttl !== undefined && ttl > 0 ? ttl : InMemoryIdempotencyStore.DEFAULT_TTL_MS;

    const entry: StoredEntry = { result };
    entry.expiresAt = Date.now() + effectiveTtl;
    entry.timer = setTimeout(() => this.delete(key), effectiveTtl);
    // Don't let the eviction timer hold the event loop open.
    if (typeof entry.timer.unref === "function") entry.timer.unref();

    this.store.set(key, entry);
    // Update LRU: remove existing entry, then push to tail.
    this.removeFromLru(key);
    this.lru.push(key);
    // Evict oldest entries if over the limit.
    this.evictIfNeeded();
  }

  /**
   * Promote a key to the LRU tail (most recently used).
   */
  private touchLru(key: string): void {
    const idx = this.lru.indexOf(key);
    if (idx !== -1) {
      this.lru.splice(idx, 1);
      this.lru.push(key);
    }
  }

  /**
   * Remove a key from the LRU tracking array.
   */
  private removeFromLru(key: string): void {
    const idx = this.lru.indexOf(key);
    if (idx !== -1) this.lru.splice(idx, 1);
  }

  /**
   * Evict the oldest (LRU head) entries when over maxEntries.
   */
  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries && this.lru.length > 0) {
      const oldest = this.lru.shift()!;
      const entry = this.store.get(oldest);
      if (entry?.timer) clearTimeout(entry.timer);
      this.store.delete(oldest);
    }
  }

  /** Remove a key and cancel its pending eviction timer. */
  delete(key: string): void {
    const entry = this.store.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    this.store.delete(key);
    this.removeFromLru(key);
  }

  /** Drop all entries and cancel every pending timer. */
  clear(): void {
    for (const entry of this.store.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.store.clear();
    this.lru.length = 0;
  }

  /** Current entry count (expired-but-not-yet-evicted entries included). */
  get size(): number {
    return this.store.size;
  }
}

/**
 * Process-wide default store used when an {@link IdempotencyConfig} omits `store`.
 */
export const defaultIdempotencyStore = new InMemoryIdempotencyStore();

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE-FLIGHT IN-FLIGHT MAP (B3 at-most-once fix)
//
// Guarantees that two concurrent runs with the same key execute the
// computation exactly once within a single process. Concurrent calls that
// arrive while a key is in-flight await the in-progress promise and share
// its result without re-executing the side effect.
//
// Guarantee provided: at-most-once per key per process lifetime (between
// in-flight-map eviction). Cross-process at-most-once still requires the
// external IdempotencyStore to be reliable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-key in-flight promise map.
 * Populated when a run begins and deleted when it settles (success or error).
 * Keyed by `"${storeId}::${key}"` so separate stores don't share slots.
 *
 * @internal
 */
export const _idempotencyInFlight: Map<
  string,
  Promise<TrackedResult<any>>
> = new Map();

/**
 * Return the composite flight key used to isolate entries per store.
 * We use the store's object identity (via a WeakMap) so different store
 * instances for the same logical key don't collide.
 * @internal
 */
const _storeIds = new WeakMap<IdempotencyStore, number>();
let _storeIdCounter = 0;

function getStoreId(store: IdempotencyStore): string {
  if (!_storeIds.has(store)) {
    _storeIds.set(store, ++_storeIdCounter);
  }
  return String(_storeIds.get(store)!);
}

/**
 * Build the in-flight map key for a given store + idempotency key + AgentUnit identity.
 *
 * Including the unit's identity prevents two unrelated operations that share the same
 * store and logical key from receiving each other's in-flight result. The persistent
 * cache path already validates the stored value's shape; the in-flight path must carry
 * the same discrimination so operation B cannot silently receive a type-incompatible
 * result from operation A's in-flight promise.
 *
 * @internal
 */
export function buildFlightKey(
  store: IdempotencyStore,
  key: string,
  unitId: string,
): string {
  return `${getStoreId(store)}::${key}::${unitId}`;
}
