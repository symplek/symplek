/**
 * @module @symplek/core/store/factory
 * @description `createDurableStore` — one backend to all store adapters (CR-403).
 *
 *   `createDurableStore(backend)` returns `DurableStoreOptions` whose `idempotency`
 *   field is fully durable (async round-trip through the backend) and whose
 *   `transactions` field is a write-through cache (in-memory reads, async writes).
 *
 * @since 2.2.0 — CR-403
 * @runtime node
 * @surface public
 */

import type { IdempotencyStore } from "../idempotency";
import { IdempotencyStoreCorruptedError, SymplekError } from "../errors";
import type {
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
  TransactionStatus,
} from "../solo/types";
import { isTrackedResult } from "../trust";
import {
  deserializeTrackedResult,
  serializeTrackedResult,
  type DurableStoreBackend,
  type DurableStoreOptions,
} from "./backend";
import type { TrackedResult } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// DURABLE IDEMPOTENCY STORE
// ─────────────────────────────────────────────────────────────────────────────

const IDEM_PREFIX = "idem:";

/**
 * Fully durable `IdempotencyStore` adapter over a `DurableStoreBackend`.
 *
 * All reads and writes go through the backend. On a process restart, results
 * persisted before the restart are available immediately via `get()`.
 *
 * @internal — create via {@link createDurableStore}
 */
class DurableIdempotencyStore implements IdempotencyStore {
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();

  constructor(private readonly backend: DurableStoreBackend) {}

  async get(key: string): Promise<TrackedResult<any> | null> {
    const raw = await this.backend.get(`${IDEM_PREFIX}${key}`);
    if (raw === null) return null;
    // raw !== null: an entry was written. A parse failure is corruption, not
    // absence. Returning null would silently authorise re-execution of a side
    // effect that may already have completed (e.g. a payment charge). Throw
    // so the caller can decide whether the side effect is safe to repeat after
    // manual inspection of the backend entry.
    let serialized: unknown;
    try {
      serialized = JSON.parse(this.dec.decode(raw));
    } catch (cause) {
      throw new IdempotencyStoreCorruptedError(key, cause);
    }
    try {
      return deserializeTrackedResult(serialized as Parameters<typeof deserializeTrackedResult>[0]);
    } catch (cause) {
      throw new IdempotencyStoreCorruptedError(key, cause);
    }
  }

  async set(key: string, result: TrackedResult<any>, ttl?: number): Promise<void> {
    if (!isTrackedResult(result)) {
      throw new SymplekError({
        code: "SETUP_ERROR",
        why: "DurableIdempotencyStore.set(): argument is not a genuine TrackedResult.",
        action: "Only results from createTrackedResult() or AgentUnit.run() may be stored.",
        context: { key },
      });
    }
    const serialized = serializeTrackedResult(result);
    const bytes = this.enc.encode(JSON.stringify(serialized));
    await this.backend.set(`${IDEM_PREFIX}${key}`, bytes, ttl);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE-THROUGH TRANSACTION LOG MANAGER
// ─────────────────────────────────────────────────────────────────────────────

const TXN_PREFIX = "txn:";

function generateTxnId(): string {
  return `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Write-through `TransactionLogManager` over a `DurableStoreBackend`.
 *
 * In-memory map is the source of truth for synchronous reads. Every mutation
 * also kicks off an async write to the backend (fire-and-forget). Individual
 * entries are NOT guaranteed to survive a crash mid-write — this is a
 * best-effort extension of the existing in-memory behavior.
 *
 * @internal — create via {@link createDurableStore}
 */
class DurableTransactionLogManager implements TransactionLogManager {
  private readonly entries = new Map<string, TransactionEntry>();
  private readonly enc = new TextEncoder();
  /**
   * Per-entry write queue. Each `persist()` call chains its backend write
   * after the previous one for the same entry id, guaranteeing that a pending
   * write can never overwrite a later committed write even when the backend
   * has variable latency.
   */
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly backend: DurableStoreBackend) {}

  /**
   * Persist `entry` to the backend, serialised per entry id so writes for
   * the same entry always apply in call order.
   *
   * Errors are written to stderr rather than silently swallowed: a failed
   * persist means the in-memory committed state will not survive a restart,
   * and the operator must be able to detect that condition.
   * @internal
   */
  private persist(entry: TransactionEntry): void {
    const bytes = this.enc.encode(JSON.stringify(entry));
    const id = entry.id;
    const prev = this.writeQueues.get(id) ?? Promise.resolve();
    const next = prev
      .then(() => this.backend.set(`${TXN_PREFIX}${id}`, bytes))
      .catch((err: unknown) => {
        process.stderr.write(
          `[symplek-journal] persist failed for ${id}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    // Remove the queue entry once settled so the map does not grow unboundedly.
    void next.finally(() => {
      if (this.writeQueues.get(id) === next) {
        this.writeQueues.delete(id);
      }
    });
    this.writeQueues.set(id, next);
  }

  create(agentId: string, action: string, input: unknown): TransactionEntry {
    const entry: TransactionEntry = {
      id: generateTxnId(),
      agentId,
      action,
      input,
      timestamp: Date.now(),
      status: "pending",
    };
    this.entries.set(entry.id, entry);
    this.persist(entry);
    return { ...entry };
  }

  commit(id: string, output: unknown): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Transaction not found: ${id}`);
    if (entry.status !== "pending")
      throw new Error(`Cannot commit ${id}: status is ${entry.status}`);
    entry.output = output;
    entry.status = "committed";
    entry.durationMs = Date.now() - entry.timestamp;
    this.persist(entry);
  }

  rollback(id: string, error?: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Transaction not found: ${id}`);
    if (entry.status !== "pending")
      throw new Error(`Cannot rollback ${id}: status is ${entry.status}`);
    entry.status = "rolledBack";
    entry.error = error;
    entry.durationMs = Date.now() - entry.timestamp;
    this.persist(entry);
  }

  get(id: string): TransactionEntry | undefined {
    const e = this.entries.get(id);
    return e ? { ...e } : undefined;
  }

  query(options: TransactionQuery = {}): TransactionEntry[] {
    const { agentId, status, action, since, until, limit } = options;
    const results: TransactionEntry[] = [];
    for (const e of this.entries.values()) {
      if (agentId !== undefined && e.agentId !== agentId) continue;
      if (status !== undefined && e.status !== status) continue;
      if (action !== undefined && e.action !== action) continue;
      if (since !== undefined && e.timestamp < since) continue;
      if (until !== undefined && e.timestamp > until) continue;
      results.push({ ...e });
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return limit !== undefined ? results.slice(0, limit) : results;
  }

  getPending(): TransactionEntry[] {
    return this.query({ status: "pending" as TransactionStatus });
  }

  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, e] of this.entries) {
      if (e.status !== "pending" && e.timestamp < cutoff) {
        this.entries.delete(id);
        this.backend.del(`${TXN_PREFIX}${id}`).catch(() => {});
        removed++;
      }
    }
    return removed;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create all store adapters from a single `DurableStoreBackend`.
 *
 * @example
 * ```typescript
 * import { createDurableStore, createFileBackend } from "@symplek/core/store";
 *
 * const store = createDurableStore(createFileBackend("./.symplek-journal"));
 *
 * const result = await unit.run(ctx, {
 *   idempotency: { key: "my-run", strategy: "return-cached", store: store.idempotency },
 * });
 * ```
 */
export function createDurableStore(backend: DurableStoreBackend): DurableStoreOptions {
  return {
    idempotency: new DurableIdempotencyStore(backend),
    transactions: new DurableTransactionLogManager(backend),
  };
}
