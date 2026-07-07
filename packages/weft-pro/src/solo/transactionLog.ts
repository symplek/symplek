/**
 * @fileoverview Transaction Log for Solo Mechanism (re-export from weft-core)
 * @description Re-exports transaction log functions and classes from weft-core.
 * @module weft-pro/solo/transactionLog
 * @since 2.2.1
 */

export {
  InMemoryTransactionLogManager,
  defaultTransactionLogManager,
  createTransaction,
  commitTransaction,
  rollbackTransaction,
  getTransaction,
  queryTransactions,
  getPendingTransactions,
  getTransactionsByAgent,
  pruneTransactions,
  getTransactionStats,
  clearAllTransactions,
} from "weft-core";
