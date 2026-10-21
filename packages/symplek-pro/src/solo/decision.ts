/**
 * @fileoverview Solo Decision Algorithm (re-export from @symplek/core)
 * @description Core decision logic for autonomous agent action.
 *              Re-exports from @symplek/core to eliminate duplication.
 * @module @symplek/pro/solo/decision
 * @since 2.2.1
 */

export {
  shouldActSolo,
  decisionFromSignals,
  meetsThresholds,
  calculateMargins,
  formatDecision,
} from "@symplek/core";
