/**
 * @fileoverview Rollback Manager for Solo Mechanism (re-export from @symplek/core)
 * @description Re-exports rollback functions from @symplek/core.
 * @module @symplek/pro/solo/rollback
 * @since 1.0.0-beta.1
 */

export {
  executeWithRollback,
  createCheckpoint,
  getCheckpoint,
  removeCheckpoint,
  getActiveCheckpoints,
  clearOldCheckpoints,
  clearAllCheckpoints,
  createObjectRollbackHandler,
  withValidation,
  composeRollbackHandlers,
} from "@symplek/core";
