/**
 * @fileoverview Rollback Manager for Solo Mechanism (re-export from weft-core)
 * @description Re-exports rollback functions from weft-core.
 * @module weft-pro/solo/rollback
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
} from "weft-core";
