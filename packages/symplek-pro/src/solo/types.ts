/**
 * @fileoverview Solo Mechanism Types (re-export from @symplek/core)
 * @description Type definitions for autonomous agent action with safety guarantees.
 *              Re-exports from @symplek/core to eliminate duplication.
 * @module @symplek/pro/solo/types
 * @since 1.0.0-beta.1
 */

export type {
  SoloDecision,
  SoloConfig,
  SoloPreset,
  SoloResult,
  LockEntry,
  LockAcquisitionResult,
  LockManager,
  TransactionStatus,
  TransactionEntry,
  TransactionQuery,
  TransactionLogManager,
  Checkpoint,
  RollbackHandler,
  RollbackOptions,
  RollbackResult,
  ExtractedSignals,
  SignalExtractionConfig,
} from "@symplek/core";

export {
  SoloBlockedError,
  LockAcquisitionError,
  RollbackError,
} from "@symplek/core";
