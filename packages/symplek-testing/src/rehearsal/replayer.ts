/**
 * @module @symplek/testing/rehearsal/replayer
 * @description Re-export shell — authoritative engine is in @symplek/core/rehearsal.
 *   Previously a −136-LOC subset of @symplek/core's replayer (missing trace-integrity
 *   block). Collapsed to a re-export so @symplek/core is the single source of truth.
 */
export * from "@symplek/core/rehearsal";
