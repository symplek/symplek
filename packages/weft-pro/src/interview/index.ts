/**
 * @fileoverview Interview module exports for @weft/core
 * @description Re-exports Interview, types, and utilities
 * @module @weft/core/interview
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Weft-interview]: Interview barrel exports
 *
 * @example
 * ```typescript
 * // Primary usage
 * import { Interview } from '@weft/core/interview';
 *
 * // Or via main package
 * import { Interview, type InterviewConfig } from '@weft/core';
 * ```
 */

// =============================================================================
// CORE CLASS
// =============================================================================

/**
 * Interview class - the primary entry point for interview configuration.
 */
export { Interview } from "./Interview";

// =============================================================================
// COMPUTATION FACTORIES (Advanced Usage)
// =============================================================================

/**
 * Computation factories for AgentUnit integration.
 * These are used internally by .interview() and .conduct() operators.
 * Exposed for advanced customization scenarios.
 */
export {
  createConductComputation,
  createInterviewComputation,
} from "./computations";

// =============================================================================
// DEFAULT AGENT GENERATORS (Advanced Usage)
// =============================================================================

/**
 * Schema-driven agent generation utilities.
 * Use these to create custom agents or inspect schema structure.
 *
 * @example
 * ```typescript
 * // Analyze a schema
 * const fields = analyzeSchema(MySchema);
 *
 * // Create custom evaluator based on default with modifications
 * const myEvaluator = (state) => {
 *   const defaultResult = createDefaultEvaluator(MySchema)(state);
 *   return defaultResult.map(score => ({
 *     ...score,
 *     overall: Math.min(score.overall * 1.1, 100) // Boost by 10%
 *   }));
 * };
 * ```
 */
export {
  type AnalyzedField,
  analyzeSchema,
  createDefaultEvaluator,
  createDefaultExtractor,
  createDefaultQuestioner,
} from "./defaultAgents";

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/**
 * Type definitions for interview configuration and results.
 * Use `import type` for these when possible.
 */
export type {
  Answer,
  Assumption,
  ClarityScore,
  // Agent function types
  EvaluatorAgent,
  ExtractorAgent,
  // Configuration
  InterviewConfig,
  InterviewHandlers,
  InterviewOptions,
  // Results
  InterviewPending,
  InterviewProgress,
  InterviewResult,
  InterviewState,
  // Supporting types
  Question,
  QuestionerAgent,
  QuestionOption,
} from "./types";
