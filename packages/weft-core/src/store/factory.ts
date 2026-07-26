/**
 * @module weft-core/store/factory
 * @description `createDurableStore` — one backend to all store adapters (CR-403).
 *
 *   `createDurableStore(backend)` returns `DurableStoreOptions` whose `idempotency`
 *   field is fully durable (async round-trip through the backend) and whose
 *   `transactions` field is a session-local log (in-memory reads, async writes to
 *   the backend for observability, but NOT hydrated on construction).
 *
 *   GUARANTEE BOUNDARY (transactions):
 *   `DurableTransactionLogManager` does NOT hydrate its in-memory map from the
 *   backend when constructed. `get()`, `query()`, and `getPending()` reflect only
 *   entries created in the CURRENT process session. A restarted process sees an
 *   empty map regardless of what is persisted in the backend.
 *   To query committed transactions across restarts, read the backend directly
 *   using the `txn:` key prefix. The backend write is best-effort (fire-and-forget
 *   per-entry write queue); persist failures are logged to stderr.
 *
 * @since 2.2.0 — CR-403
 * @runtime node
 * @surface public
 */

import type { IdempotencyStore } from "../idempotency";
import { IdempotencyStoreCorruptedError, WeftError } from "../errors";
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
 * Structural guard for deserialized idempotency entries.
 *
 * JSON.parse succeeds on any syntactically valid JSON — `{}`, `[]`, `42` — so a
 * syntactically valid but structurally foreign entry would be forwarded to
 * `deserializeTrackedResult` and silently reconstructed with undefined metadata,
 * becoming a trusted cache hit that skips a computation that never actually ran.
 *
 * This guard checks the minimum required shape before trusting the entry. It is
 * intentionally conservative: it only checks field presence and primitive types,
 * not domain invariants (e.g. 0 ≤ confidence ≤ 1), to avoid breaking valid
 * entries that have unusual-but-legal values.
 */
function isValidSerializedShape(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    "value" in r &&
    typeof r.source === "string" &&
    typeof r.confidence === "number" &&
    Array.isArray(r.sourceChain) &&
    typeof r.minChainConfidence === "number"
  );
}

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
    // Structural guard: syntactically valid JSON that lacks required TrackedResult
    // fields (e.g. `{}` or a stale foreign entry) must not be promoted to a trusted
    // cache hit. `deserializeTrackedResult` does not validate its input — it would
    // silently reconstruct a result with undefined metadata and register it in the
    // WeakSet, causing `resume()` to skip a computation that never actually committed.
    if (!isValidSerializedShape(serialized)) {
      throw new IdempotencyStoreCorruptedError(
        key,
        new Error(
          "entry parsed as JSON but is structurally invalid: " +
          "required fields (value, source, confidence, sourceChain, minChainConfidence) " +
          "are absent or have the wrong type. Inspect the backend record before re-executing.",
        ),
      );
    }
    try {
      return deserializeTrackedResult(serialized as Parameters<typeof deserializeTrackedResult>[0]);
    } catch (cause) {
      throw new IdempotencyStoreCorruptedError(key, cause);
    }
  }

  async set(key: string, result: TrackedResult<any>, ttl?: number): Promise<void> {
    if (!isTrackedResult(result)) {
      throw new WeftError({
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
 * Session-local `TransactionLogManager` with best-effort backend persistence.
 *
 * **What this provides:**
 * In-memory reads — `get()`, `query()`, and `getPending()` — are synchronous and
 * reflect entries created in the CURRENT process session. Every mutation also
 * enqueues a best-effort async write to the backend (per-entry write queue ensures
 * ordering; failures are logged to stderr, not thrown).
 *
 * **What this does NOT provide (important):**
 * The in-memory map is NOT hydrated from the backend on construction. After a
 * process restart all three read methods operate on an empty map — committed entries
 * in the backend are invisible until the current session recreates them. This means
 * `getPending()` will not surface transactions that were pending when the previous
 * process crashed, and `resume()` cannot consult the transaction log across restarts.
 *
 * To query journal entries across restarts, read the backend directly with the
 * `txn:` key prefix via `backend.list("txn:")` and `backend.get(key)`.
 *
 * If cross-restart read access is required, implement hydration in a downstream
 * adapter rather than in this class — hydration requires an async initialization
 * path that would break the synchronous `TransactionLogManager` interface.
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
          `[weft-journal] persist failed for ${id}: ${err instanceof Error ? err.message : String(err)}\n`,
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
 * import { createDurableStore, createFileBackend } from "weft-core/store";
 *
 * const store = createDurableStore(createFileBackend("./.weft-journal"));
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
