/**
 * @module weft-core/store/backend
 * @description Persistence seam for durable agent execution (CR-403).
 *
 *   One interface (`DurableStoreBackend`) backs all store types simultaneously
 *   through `createDurableStore()`. Implement the four-method KV contract to
 *   get durable idempotency and transaction log in one shot.
 *
 *   GUARANTEE BOUNDARY (stated precisely, as the repair campaign required):
 *   Durability narrows the at-most-once window but does not remove it. If
 *   `backend.set()` fails after a side effect runs, the idempotency key was
 *   never written. A later call with the same key will re-execute the side
 *   effect. Making the side effect itself idempotent is the only way to close
 *   this gap. `resume()` replays committed steps only; an uncommitted step
 *   (whose set() failed) will re-execute on every resume attempt.
 *
 * @since 2.2.0 — CR-403
 * @runtime node
 * @surface public
 */

import type { IdempotencyStore } from "../idempotency";
import type { TransactionLogManager } from "../solo/types";
export type { SerializedTrackedResult } from "../trust";
export { serializeTrackedResult, deserializeTrackedResult } from "../trust";

// ─────────────────────────────────────────────────────────────────────────────
// CORE KV CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal KV backend. Implement this one interface to get durable idempotency
 * and transaction log simultaneously via {@link createDurableStore}.
 *
 * @remarks
 * Values are raw bytes — the store layer handles JSON encoding/decoding.
 * The `ttl` parameter is advisory; backends that do not support TTL may ignore
 * it. The `list(prefix)` method must return all keys with the given prefix
 * in an arbitrary but deterministic order.
 *
 * Concrete adapters for Redis, Postgres, SQLite, and Convex live in downstream
 * packages. This interface is the extension point; only the file-backed
 * reference implementation ships in weft-core.
 */
export interface DurableStoreBackend {
  /** Return the value for `key`, or `null` if absent. */
  get(key: string): Promise<Uint8Array | null>;
  /** Persist `value` under `key`, optionally expiring after `ttl` ms. */
  set(key: string, value: Uint8Array, ttl?: number): Promise<void>;
  /** Delete `key` (no-op if absent). */
  del(key: string): Promise<void>;
  /** Return all keys with the given prefix, in stable order. */
  list(prefix: string): Promise<string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE OPTIONS BUNDLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All store types backed by one `DurableStoreBackend`.
 *
 * @remarks
 * Pass to {@link AgentUnit.run} via `options.idempotency.store` or
 * via the {@link resume} helper. Each field satisfies its existing interface
 * (e.g. `IdempotencyStore`, `TransactionLogManager`) so callers can inject
 * stores independently without migrating the whole pipeline.
 *
 * Create via {@link createDurableStore}.
 */
export interface DurableStoreOptions {
  /** Durable {@link IdempotencyStore} — persists results across process restarts. */
  idempotency: IdempotencyStore;
  /**
   * Write-through {@link TransactionLogManager} — in-memory reads,
   * best-effort async writes to the backend. Durability of individual
   * entries is not guaranteed if the process crashes mid-write.
   */
  transactions: TransactionLogManager;
}
