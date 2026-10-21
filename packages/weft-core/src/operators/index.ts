/**
 * @module @symplek/core/operators/index
 * @description Barrel re-exporting all free-tier operator factories and associated classes.
 *   Import from '@symplek/core/operators' (or the parent barrel src/operators.ts).
 * @blast_radius MEDIUM - Changing exports here affects the entire operator surface.
 * @status STABLE
 */

export { CoherenceError, createCoherenceComputation } from "./coherence";
export { createConsensusComputation } from "./consensus";
export { createConvergeComputation } from "./converge";
export { createDebateComputation } from "./debate";
export { createDialecticComputation } from "./dialectic";
export { createFallbackComputation } from "./fallback";
export { createReflectComputation, REFLECT_MAX_DEPTH } from "./reflect";
export { createRetryComputation } from "./retry";
export { createSoloComputation, extractSignals } from "./solo";
export { createTrackedComputation } from "./sourceTracking";
export { createTimeoutComputation } from "./timeout";
// ─── Operator type surface (for pro re-exports via @symplek/core/operators subpath) ─
export type {
  AdvisorAgent,
  CoherenceOptions,
  CoherenceResult,
  ConvergeContribution,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  Critique,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  SynthesisResponse,
  ThesisResponse,
} from "../types";
