/**
 * @module weft-testing/rehearsal/replayer
 * @description Re-export shell — authoritative engine is in weft-core/rehearsal.
 *   Previously a −136-LOC subset of weft-core's replayer (missing trace-integrity
 *   block). Collapsed to a re-export so weft-core is the single source of truth.
 */
export * from "weft-core/rehearsal";
