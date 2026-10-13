/**
 * @fileoverview Transaction Log for Solo Mechanism
 * @description Append-only transaction log for audit trail and rollback
 * @module weft-core/solo/transactionLog
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[STORY-01.07]: Transaction log implementation
 *
 * @remarks
 * The transaction log provides:
 * - Audit trail: Every solo action is logged with agent, action, input/output
 * - Rollback support: Pending transactions can be rolled back on failure
 * - Query capabilities: Find transactions by agent, status, time range
 *
 * Design: Append-only log (entries are never modified, only status changes)
 */

import type {
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION LOG STORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global transaction store for in-memory implementation.
 * @internal
 */
const transactions = new Map<string, TransactionEntry>();

// ─────────────────────────────────────────────────────────────────────────────
// ID GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique transaction ID.
 * Format: txn_{timestamp}_{random}
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `txn_${timestamp}_${random}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE TRANSACTION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new pending transaction.
 *
 * @param agentId - Agent initiating the transaction
 * @param action - Action being performed
 * @param input - Input data for the action
 * @returns The created transaction entry
 *
 * @example
 * ```typescript
 * const txn = createTransaction("agent-1", "updateProfile", { userId: 123 });
 * try {
 *   const result = await performAction(txn.input);
 *   commitTransaction(txn.id, result);
 * } catch (error) {
 *   rollbackTransaction(txn.id, error.message);
 * }
 * ```
 */
export function createTransaction(
  agentId: string,
  action: string,
  input: unknown,
): TransactionEntry {
  const entry: TransactionEntry = {
    id: generateTransactionId(),
    agentId,
    action,
    input,
    timestamp: Date.now(),
    status: "pending",
  };

  transactions.set(entry.id, entry);
  return entry;
}

/**
 * Mark a transaction as committed.
 *
 * @param id - Transaction ID
 * @param output - Output from the successful action
 */
export function commitTransaction(id: string, output: unknown): void {
  const entry = transactions.get(id);
  if (!entry) {
    throw new Error(`Transaction not found: ${id}`);
  }

  if (entry.status !== "pending") {
    throw new Error(
      `Cannot commit transaction ${id}: status is ${entry.status}, not pending`,
    );
  }

  entry.output = output;
  entry.status = "committed";
  entry.durationMs = Date.now() - entry.timestamp;
}

/**
 * Mark a transaction as rolled back.
 *
 * @param id - Transaction ID
 * @param error - Optional error message explaining the rollback
 */
export function rollbackTransaction(id: string, error?: string): void {
  const entry = transactions.get(id);
  if (!entry) {
    throw new Error(`Transaction not found: ${id}`);
  }

  if (entry.status !== "pending") {
    throw new Error(
      `Cannot rollback transaction ${id}: status is ${entry.status}, not pending`,
    );
  }

  entry.status = "rolledBack";
  entry.error = error;
  entry.durationMs = Date.now() - entry.timestamp;
}

/**
 * Get a transaction by ID.
 *
 * @param id - Transaction ID
 * @returns Transaction entry or undefined
 */
export function getTransaction(id: string): TransactionEntry | undefined {
  const entry = transactions.get(id);
  return entry ? { ...entry } : undefined;
}

/**
 * Query transactions by various criteria.
 *
 * @param query - Query parameters
 * @returns Matching transaction entries (newest first)
 */
export function queryTransactions(
  query: TransactionQuery = {},
): TransactionEntry[] {
  const { agentId, status, action, since, until, limit } = query;
  const results: TransactionEntry[] = [];

  for (const entry of transactions.values()) {
    // Apply filters
    if (agentId !== undefined && entry.agentId !== agentId) continue;
    if (status !== undefined && entry.status !== status) continue;
    if (action !== undefined && entry.action !== action) continue;
    if (since !== undefined && entry.timestamp < since) continue;
    if (until !== undefined && entry.timestamp > until) continue;

    results.push({ ...entry });
  }

  // Sort by timestamp descending (newest first)
  results.sort((a, b) => b.timestamp - a.timestamp);

  // Apply limit
  if (limit !== undefined && results.length > limit) {
    return results.slice(0, limit);
  }

  return results;
}

/**
 * Get all pending transactions.
 *
 * @returns Array of pending transaction entries
 */
export function getPendingTransactions(): TransactionEntry[] {
  return queryTransactions({ status: "pending" });
}

/**
 * Get transactions by agent.
 *
 * @param agentId - Agent to filter by
 * @param limit - Maximum number of results
 * @returns Transaction entries for the agent
 */
export function getTransactionsByAgent(
  agentId: string,
  limit?: number,
): TransactionEntry[] {
  return queryTransactions({ agentId, limit });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove completed transactions older than the specified time.
 *
 * @param olderThanMs - Maximum age in milliseconds
 * @returns Number of pruned transactions
 */
export function pruneTransactions(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  let count = 0;

  for (const [id, entry] of transactions) {
    // Only prune completed (committed or rolledBack) transactions
    if (entry.status !== "pending" && entry.timestamp < cutoff) {
      transactions.delete(id);
      count++;
    }
  }

  return count;
}

/**
 * Get transaction log statistics.
 *
 * @returns Statistics about the transaction log
 */
export function getTransactionStats(): {
  total: number;
  pending: number;
  committed: number;
  rolledBack: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
} {
  const stats = {
    total: transactions.size,
    pending: 0,
    committed: 0,
    rolledBack: 0,
    oldestTimestamp: undefined as number | undefined,
    newestTimestamp: undefined as number | undefined,
  };

  for (const entry of transactions.values()) {
    // Count by status
    if (entry.status === "pending") stats.pending++;
    else if (entry.status === "committed") stats.committed++;
    else if (entry.status === "rolledBack") stats.rolledBack++;

    // Track timestamps
    if (
      stats.oldestTimestamp === undefined ||
      entry.timestamp < stats.oldestTimestamp
    ) {
      stats.oldestTimestamp = entry.timestamp;
    }
    if (
      stats.newestTimestamp === undefined ||
      entry.timestamp > stats.newestTimestamp
    ) {
      stats.newestTimestamp = entry.timestamp;
    }
  }

  return stats;
}

/**
 * Clear all transactions (for testing).
 * @internal
 */
export function clearAllTransactions(): void {
  transactions.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION LOG MANAGER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory transaction log manager implementation.
 * Implements the TransactionLogManager interface.
 */
export class InMemoryTransactionLogManager implements TransactionLogManager {
  create(agentId: string, action: string, input: unknown): TransactionEntry {
    return createTransaction(agentId, action, input);
  }

  commit(id: string, output: unknown): void {
    commitTransaction(id, output);
  }

  rollback(id: string, error?: string): void {
    rollbackTransaction(id, error);
  }

  get(id: string): TransactionEntry | undefined {
    return getTransaction(id);
  }

  query(options: TransactionQuery): TransactionEntry[] {
    return queryTransactions(options);
  }

  getPending(): TransactionEntry[] {
    return getPendingTransactions();
  }

  prune(olderThanMs: number): number {
    return pruneTransactions(olderThanMs);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default transaction log manager instance.
 */
export const defaultTransactionLogManager = new InMemoryTransactionLogManager();
