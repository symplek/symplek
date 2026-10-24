/**
 * @fileoverview Basic operators for AgentUnit — re-export barrel.
 * @description All operator implementations live under ./operators/*.ts.
 *   This file exists as a stable import path for the rest of the codebase.
 * @module @symplek/core/operators
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.04]: Basic operators for @symplek/core package (MIT License)
 */

export {
  CoherenceError,
  createCoherenceComputation,
} from "./operators/coherence";
export { createConsensusComputation } from "./operators/consensus";
export { createConvergeComputation } from "./operators/converge";
export { createDebateComputation } from "./operators/debate";
export { createDialecticComputation } from "./operators/dialectic";
export { createFallbackComputation } from "./operators/fallback";
export { createRetryComputation } from "./operators/retry";
export { createSoloComputation, extractSignals } from "./operators/solo";
export { createTrackedComputation } from "./operators/sourceTracking";
export { createTimeoutComputation } from "./operators/timeout";
