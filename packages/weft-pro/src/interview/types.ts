/**
 * @fileoverview Interview Types - Type definitions for human-in-the-loop Q&A
 * @description Complete type definitions for the interview operator system
 * @module @weft/core/interview/types
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Weft-interview]: Types for .interview() and .conduct() operators
 */

import type { AgentUnit } from "@weft/core";
import type { z } from "zod";

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Configuration for the `.interview()` operator.
 *
 * @typeParam TContext - The target context schema type
 *
 * @remarks
 * InterviewConfig follows the Weft pattern of schema-driven defaults
 * with optional overrides for power users.
 */
export interface InterviewConfig<TContext> {
  /**
   * Target schema for extracted context.
   * Schema is used to:
   * 1. Type the final InterviewResult.context
   * 2. Generate default evaluator/questioner/extractor (if not overridden)
   * 3. Validate extracted context at runtime
   */
  contextSchema: z.ZodType<TContext>;

  /**
   * Termination and behavior options.
   */
  options?: InterviewOptions;

  /**
   * Custom clarity evaluator.
   * Default: Schema-driven evaluator that scores field completeness.
   */
  evaluator?: EvaluatorAgent;

  /**
   * Custom question generator.
   * Default: Schema-driven questioner targeting lowest-clarity fields.
   * Return null to indicate no more questions needed.
   */
  questioner?: QuestionerAgent;

  /**
   * Custom context extractor.
   * Default: Schema-driven extractor mapping answers to fields.
   */
  extractor?: ExtractorAgent<TContext>;
}

/**
 * Termination and behavior options for interview.
 */
export interface InterviewOptions {
  /**
   * Stop when clarity score >= threshold.
   * @default 70
   */
  clarityThreshold?: number;

  /**
   * Maximum questions to ask (hard cap).
   * @default 10
   */
  maxQuestions?: number;

  /**
   * Schema fields that must be non-null/undefined before terminating.
   * Even if clarityThreshold is met, interview continues until these are populated.
   */
  requiredFields?: string[];

  /**
   * Custom termination predicate.
   * Checked AFTER clarityThreshold but BEFORE maxQuestions.
   */
  isDone?: (state: InterviewState) => boolean;
}

// =============================================================================
// HANDLER TYPES
// =============================================================================

/**
 * Handlers for interview execution.
 * Provided to `.conduct()` operator.
 */
export interface InterviewHandlers {
  /**
   * REQUIRED: Get user answer for a question.
   * This is the human-in-the-loop callback.
   */
  onQuestion: (question: Question) => Promise<Answer>;

  /**
   * Optional: Called when clarity score updates.
   * Use for real-time UI feedback.
   */
  onClarityUpdate?: (score: ClarityScore) => void;

  /**
   * Optional: Called with progress state after each round.
   * Use for progress indicators.
   */
  onProgress?: (progress: InterviewProgress) => void;
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Result from a completed interview.
 *
 * @typeParam TContext - The extracted context type (from schema)
 */
export interface InterviewResult<TContext> {
  /**
   * Extracted context, typed by the schema.
   * Validated against contextSchema at extraction time.
   */
  context: TContext;

  /**
   * Final clarity score achieved (0-100).
   */
  clarityScore: number;

  /**
   * Number of questions asked.
   */
  questionsAsked: number;

  /**
   * Full conversation history.
   */
  answers: Answer[];

  /**
   * AI assumptions for transparency.
   * Includes inferred values and defaults applied.
   */
  assumptions: Assumption[];

  /**
   * True if clarity threshold was met.
   * False if maxQuestions was hit first.
   */
  converged: boolean;
}

/**
 * Pending interview configuration.
 * Returned by `.interview()`, consumed by `.conduct()`.
 *
 * @typeParam TContext - The target context schema type
 *
 * @remarks
 * InterviewPending is a marker type that signals the AgentUnit
 * is ready for `.conduct()` to execute the interview.
 */
export interface InterviewPending<TContext> {
  /** Marker to identify this as a pending interview */
  readonly __interviewPending: true;

  /** The interview configuration */
  readonly interview: import("./Interview").Interview<TContext>;

  /** Initial input to the interview */
  readonly initialInput: string;
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

/**
 * One option for a multiple-choice question.
 * When questioners provide options, UIs can show them as clickable choices
 * that match the question semantically instead of generic targetField-based defaults.
 */
export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * A question generated by the questioner.
 */
export interface Question {
  /** Unique identifier for this question */
  id: string;

  /** The question text to display to the user */
  text: string;

  /** Which schema field this question targets (for clarity tracking) */
  targetField?: string;

  /** Priority level (affects question ordering) */
  priority: "high" | "medium" | "low";

  /**
   * Optional multiple-choice options (id, label, description).
   * When present, UIs should prefer these over targetField-based defaults
   * so options match the question text semantically.
   */
  options?: QuestionOption[];
}

/**
 * An answer from the user.
 */
export interface Answer {
  /** ID of the question this answers */
  questionId: string;

  /** The user's response text */
  text: string;

  /** When the answer was provided */
  timestamp: number;

  /** The question text that was asked (for context awareness) */
  questionText?: string;
}

/**
 * Clarity score with per-field breakdown.
 */
export interface ClarityScore {
  /**
   * Overall clarity score (0-100).
   * Aggregated from per-field scores with weighting.
   */
  overall: number;

  /**
   * Per-field clarity scores.
   * Keys match schema field names.
   */
  byField: Record<string, number>;

  /**
   * Fields that are still critically missing.
   * Used by questioner to prioritize.
   */
  missingCritical: string[];
}

/**
 * Progress state for UI feedback.
 */
export interface InterviewProgress {
  /** Questions asked so far */
  questionsAsked: number;

  /** Maximum questions allowed */
  maxQuestions: number;

  /** Current clarity score */
  clarityScore: number;

  /** Target clarity threshold */
  clarityThreshold: number;

  /** Estimated questions remaining (heuristic) */
  estimatedRemaining: number;
}

/**
 * An assumption made by the AI during extraction.
 */
export interface Assumption {
  /** Schema field this assumption applies to */
  field: string;

  /** The assumed value */
  value: unknown;

  /** Confidence in this assumption (0-1) */
  confidence: number;

  /** How this value was determined */
  source: "inferred" | "default";
}

/**
 * Current interview state passed to agents.
 */
export interface InterviewState {
  /** All answers collected so far */
  answers: Answer[];

  /** All questions asked so far (for deduplication and context) */
  askedQuestions?: Question[];

  /** Partially extracted context */
  currentContext: Record<string, unknown>;

  /** History of clarity scores (for trend analysis) */
  clarityHistory: ClarityScore[];

  /** Current round number (1-indexed) */
  round: number;

  /** Initial input that started the interview */
  initialInput: string;
}

// =============================================================================
// AGENT FUNCTION TYPES
// =============================================================================

/**
 * Type for evaluator agent function.
 */
export type EvaluatorAgent = (state: InterviewState) => AgentUnit<ClarityScore>;

/**
 * Type for questioner agent function.
 */
export type QuestionerAgent = (
  state: InterviewState,
  clarity: ClarityScore,
) => AgentUnit<Question | null>;

/**
 * Type for extractor agent function.
 */
export type ExtractorAgent<TContext> = (
  state: InterviewState,
) => AgentUnit<TContext>;
