/**
 * @fileoverview Solo Module Barrel Export
 * @description Public API for autonomous agent action mechanism
 * @module @symplek/core/solo
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[STORY-01.10]: Barrel exports for solo module
 *
 * @remarks
 * The Solo mechanism enables agents to act autonomously when:
 * - Confidence is high (>= 0.90 by default)
 * - Coherence is high (>= 0.85 by default)
 * - Risk is low (<= 0.30 by default)
 * - Distributed lock is acquired
 *
 * @example
 * ```typescript
 * import {
 *   shouldActSolo,
 *   acquireLock,
 *   releaseLock,
 *   createTransaction,
 *   executeWithRollback,
 *   SOLO_DEFAULTS,
 * } from '@symplek/core/solo';
 *
 * // Check if agent should act solo
 * const decision = shouldActSolo(0.92, 0.88, 0.15, true);
 * if (decision.canActSolo) {
 *   // Proceed with autonomous action
 * }
 * ```
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────
export {
  getPresetFromConfig,
  mergeConfig,
  resolvePreset,
  SOLO_DEFAULTS,
  SOLO_PRESETS,
  validateConfig,
} from "./config";
// ─── DECISION ────────────────────────────────────────────────────────────────
export {
  calculateMargins,
  decisionFromSignals,
  formatDecision,
  meetsThresholds,
  shouldActSolo,
} from "./decision";
// ─── LOCK ────────────────────────────────────────────────────────────────────
export {
  // Core functions
  acquireLock,
  cleanupExpiredLocks,
  clearAllLocks,
  defaultLockManager,
  extendLock,
  forceReleaseLock,
  // Utilities
  getActiveLocks,
  getLockHolder,
  // Manager class
  InMemoryLockManager,
  isLockHeld,
  releaseLock,
} from "./lock";
// ─── ROLLBACK ────────────────────────────────────────────────────────────────
export {
  clearAllCheckpoints,
  clearOldCheckpoints,
  composeRollbackHandlers,
  // Checkpoint management
  createCheckpoint,
  // Utilities
  createObjectRollbackHandler,
  // Core functions
  executeWithRollback,
  getActiveCheckpoints,
  getCheckpoint,
  removeCheckpoint,
  withValidation,
} from "./rollback";
// ─── TRANSACTION LOG ─────────────────────────────────────────────────────────
export {
  clearAllTransactions,
  commitTransaction,
  // Core functions
  createTransaction,
  defaultTransactionLogManager,
  getPendingTransactions,
  getTransaction,
  getTransactionStats,
  getTransactionsByAgent,
  // Manager class
  InMemoryTransactionLogManager,
  // Utilities
  pruneTransactions,
  queryTransactions,
  rollbackTransaction,
} from "./transactionLog";
// ─── TYPES ───────────────────────────────────────────────────────────────────
export type {
  // Rollback types
  Checkpoint,
  // Signal types
  ExtractedSignals,
  LockAcquisitionResult,
  // Lock types
  LockEntry,
  LockManager,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
  SignalExtractionConfig,
  SoloConfig,
  // Core types
  SoloDecision,
  SoloPreset,
  SoloResult,
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
  // Transaction types
  TransactionStatus,
} from "./types";
// ─── ERRORS ──────────────────────────────────────────────────────────────────
export {
  LockAcquisitionError,
  RollbackError,
  SoloBlockedError,
} from "./types";
