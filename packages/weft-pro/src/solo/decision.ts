/**
 * @fileoverview Solo Decision Algorithm (re-export from weft-core)
 * @description Core decision logic for autonomous agent action.
 *              Re-exports from weft-core to eliminate duplication.
 * @module weft-pro/solo/decision
 * @since 2.2.1
 */

export {
  shouldActSolo,
  decisionFromSignals,
  meetsThresholds,
  calculateMargins,
  formatDecision,
} from "weft-core";
