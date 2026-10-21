/**
 * @fileoverview Solo Module Barrel Export
 * @description Public API for autonomous agent action mechanism.
 *              Re-exports from @symplek/core to eliminate duplication.
 * @module @symplek/pro/solo
 * @since 1.0.0-beta.1
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
 * } from '@symplek/pro/solo';
 *
 * // Check if agent should act solo
 * const decision = shouldActSolo(0.92, 0.88, 0.15, true);
 * if (decision.canActSolo) {
 *   // Proceed with autonomous action
 * }
 * ```
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "../license-gate";

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
  acquireLock,
  cleanupExpiredLocks,
  clearAllLocks,
  defaultLockManager,
  extendLock,
  forceReleaseLock,
  getActiveLocks,
  getLockHolder,
  InMemoryLockManager,
  isLockHeld,
  releaseLock,
} from "./lock";
// ─── ROLLBACK ────────────────────────────────────────────────────────────────
export {
  clearAllCheckpoints,
  clearOldCheckpoints,
  composeRollbackHandlers,
  createCheckpoint,
  createObjectRollbackHandler,
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
  createTransaction,
  defaultTransactionLogManager,
  getPendingTransactions,
  getTransaction,
  getTransactionStats,
  getTransactionsByAgent,
  InMemoryTransactionLogManager,
  pruneTransactions,
  queryTransactions,
  rollbackTransaction,
} from "./transactionLog";
// ─── TYPES ───────────────────────────────────────────────────────────────────
export type {
  Checkpoint,
  ExtractedSignals,
  LockAcquisitionResult,
  LockEntry,
  LockManager,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
  SignalExtractionConfig,
  SoloConfig,
  SoloDecision,
  SoloPreset,
  SoloResult,
  TransactionEntry,
  TransactionLogManager,
  TransactionQuery,
  TransactionStatus,
} from "./types";
// ─── ERRORS ──────────────────────────────────────────────────────────────────
export {
  LockAcquisitionError,
  RollbackError,
  SoloBlockedError,
} from "./types";
