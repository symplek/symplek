/**
 * @fileoverview Solo Mechanism Types (re-export from weft-core)
 * @description Type definitions for autonomous agent action with safety guarantees.
 *              Re-exports from weft-core to eliminate duplication.
 * @module weft-pro/solo/types
 * @since 2.2.1
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
} from "weft-core";

export {
  SoloBlockedError,
  LockAcquisitionError,
  RollbackError,
} from "weft-core";
