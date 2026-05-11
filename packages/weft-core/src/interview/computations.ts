/**
 * @fileoverview Interview computation factories
 * @description createInterviewComputation and createConductComputation following operator pattern
 * @module weft-core/interview/computations
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Weft-interview]: Computation factories for interview operators
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import type { AgentContext } from "../types";
import type { Interview } from "./Interview";
import type {
  Assumption,
  ClarityScore,
  InterviewHandlers,
  InterviewOptions,
  InterviewPending,
  InterviewProgress,
  InterviewResult,
  InterviewState,
} from "./types";

// =============================================================================
// INTERVIEW COMPUTATION (Configuration Phase)
// =============================================================================

/**
 * Creates a computation that configures an interview.
 * Returns InterviewPending, which is consumed by createConductComputation.
 *
 * @remarks
 * This is the LAZY part - no execution happens here.
 * The interview only runs when .conduct() is called.
 *
 * @param initialInput - The initial input string to start the interview
 * @param interview - The Interview configuration instance
 * @param _innerMeta - Metadata from the source AgentUnit (unused but part of pattern)
 * @returns AgentComputation producing InterviewPending
 *
 * @example
 * ```typescript
 * const computation = createInterviewComputation(
 *   "Build a task app",
 *   Interview.create({ contextSchema }),
 *   metadata
 * );
 * const pending = await computation(ctx);
 * ```
 */
export function createInterviewComputation<TContext>(
  initialInput: string,
  interview: Interview<TContext>,
  _innerMeta: AgentUnitMetadata,
): AgentComputation<InterviewPending<TContext>> {
  return async (_ctx: AgentContext): Promise<InterviewPending<TContext>> => {
    // Simply wrap the configuration - no execution yet
    return {
      __interviewPending: true,
      interview,
      initialInput,
    };
  };
}

// =============================================================================
// CONDUCT COMPUTATION (Execution Phase)
// =============================================================================

/**
 * Creates a computation that executes an interview.
 * Runs the interview loop with human-in-the-loop callbacks.
 *
 * @remarks
 * This is the EXECUTION part - the interview loop runs here.
 * Handles:
 * - Clarity evaluation
 * - Termination condition checking
 * - Question generation
 * - Human answer collection (async)
 * - Context extraction
 *
 * @param pending - The InterviewPending from createInterviewComputation
 * @param handlers - The InterviewHandlers with callbacks
 * @param _innerMeta - Metadata from the source AgentUnit (unused but part of pattern)
 * @returns AgentComputation producing InterviewResult
 *
 * @example
 * ```typescript
 * const computation = createConductComputation(pending, handlers, metadata);
 * const result = await computation(ctx);
 * // { context: {...}, clarityScore: 85, converged: true, ... }
 * ```
 */
export function createConductComputation<TContext>(
  pending: InterviewPending<TContext>,
  handlers: InterviewHandlers,
  _innerMeta: AgentUnitMetadata,
): AgentComputation<InterviewResult<TContext>> {
  const { interview, initialInput } = pending;
  const { options, evaluator, questioner, extractor } = interview;

  return async (ctx: AgentContext): Promise<InterviewResult<TContext>> => {
    // Initialize state
    const state: InterviewState = {
      answers: [],
      currentContext: {},
      clarityHistory: [],
      round: 0,
      initialInput,
    };

    let currentClarity: ClarityScore = {
      overall: 0,
      byField: {},
      missingCritical: [],
    };

    // =========================================================================
    // INTERVIEW LOOP
    // =========================================================================

    while (true) {
      state.round++;

      // -----------------------------------------------------------------------
      // STEP 1: EVALUATE CLARITY
      // -----------------------------------------------------------------------

      const clarityResult = await evaluator(state).run(ctx, {
        trustMode: "legacy",
      });
      currentClarity = clarityResult;
      state.clarityHistory.push(currentClarity);

      // Call clarity update callback
      if (handlers.onClarityUpdate) {
        handlers.onClarityUpdate(currentClarity);
      }

      // -----------------------------------------------------------------------
      // STEP 2: CHECK TERMINATION CONDITIONS (in precedence order)
      // -----------------------------------------------------------------------

      const shouldTerminate = checkTermination(state, currentClarity, options);

      if (shouldTerminate.terminate) {
        break;
      }

      // -----------------------------------------------------------------------
      // STEP 3: GENERATE QUESTION
      // -----------------------------------------------------------------------

      const questionResult = await questioner(state, currentClarity).run(ctx, {
        trustMode: "legacy",
      });

      // null means questioner has no more questions
      if (questionResult === null) {
        break;
      }

      // -----------------------------------------------------------------------
      // STEP 4: GET HUMAN ANSWER (async callback)
      // -----------------------------------------------------------------------

      const answer = await handlers.onQuestion(questionResult);

      state.answers.push(answer);

      // -----------------------------------------------------------------------
      // STEP 5: UPDATE STATE AND CALLBACKS
      // -----------------------------------------------------------------------

      // Call progress callback
      if (handlers.onProgress) {
        const progress = calculateProgress(state, currentClarity, options);
        handlers.onProgress(progress);
      }
    }

    // =========================================================================
    // EXTRACTION PHASE
    // =========================================================================

    const extractedContext = await extractor(state).run(ctx, {
      trustMode: "legacy",
    });

    // Build assumptions list (for transparency)
    const assumptions = buildAssumptions(state, extractedContext);

    // Determine if we converged (hit threshold) or exhausted (hit max)
    const converged = currentClarity.overall >= options.clarityThreshold;

    return {
      context: extractedContext,
      clarityScore: currentClarity.overall,
      questionsAsked: state.answers.length,
      answers: state.answers,
      assumptions,
      converged,
    };
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check all termination conditions in precedence order.
 *
 * @remarks
 * Precedence:
 * 1. maxQuestions (hard cap) - Safety valve
 * 2. isDone predicate (custom) - Domain-specific early termination
 * 3. requiredFields (schema validation) - Contract requirements
 * 4. clarityThreshold (default) - Normal completion
 *
 * @param state - Current interview state
 * @param clarity - Latest clarity score
 * @param options - Interview options
 * @returns Object with terminate flag and reason
 */
function checkTermination(
  state: InterviewState,
  clarity: ClarityScore,
  options: Required<InterviewOptions>,
): { terminate: boolean; reason?: string } {
  // 1. Hard cap: maxQuestions
  if (state.answers.length >= options.maxQuestions) {
    return { terminate: true, reason: "maxQuestions" };
  }

  // 2. Custom predicate: isDone
  if (options.isDone(state)) {
    return { terminate: true, reason: "isDone" };
  }

  // 3. Required fields check (must be populated even if clarity is high)
  const hasAllRequired = options.requiredFields.every((field) => {
    const fieldClarity = clarity.byField[field];
    return fieldClarity !== undefined && fieldClarity >= 80;
  });

  // 4. Clarity threshold (only if required fields are met)
  if (clarity.overall >= options.clarityThreshold && hasAllRequired) {
    return { terminate: true, reason: "clarityThreshold" };
  }

  return { terminate: false };
}

/**
 * Calculate progress for UI feedback.
 *
 * @remarks
 * Estimates remaining questions based on clarity improvement rate.
 * Falls back to max questions if no history available.
 *
 * @param state - Current interview state
 * @param clarity - Latest clarity score
 * @param options - Interview options
 * @returns Progress object for UI display
 */
function calculateProgress(
  state: InterviewState,
  clarity: ClarityScore,
  options: Required<InterviewOptions>,
): InterviewProgress {
  const questionsAsked = state.answers.length;
  const clarityGap = options.clarityThreshold - clarity.overall;

  // Estimate remaining based on clarity improvement rate
  let estimatedRemaining = 0;
  if (state.clarityHistory.length > 1 && questionsAsked > 0) {
    const clarityPerQuestion = clarity.overall / questionsAsked;
    if (clarityPerQuestion > 0) {
      estimatedRemaining = Math.ceil(clarityGap / clarityPerQuestion);
    }
  } else {
    // No history yet, estimate based on max
    estimatedRemaining = options.maxQuestions - questionsAsked;
  }

  return {
    questionsAsked,
    maxQuestions: options.maxQuestions,
    clarityScore: clarity.overall,
    clarityThreshold: options.clarityThreshold,
    estimatedRemaining: Math.max(
      0,
      Math.min(estimatedRemaining, options.maxQuestions - questionsAsked),
    ),
  };
}

/**
 * Build assumptions list for transparency.
 *
 * @remarks
 * Identifies values in the final context that weren't explicitly
 * provided in user answers - these are AI inferences.
 *
 * @param state - Final interview state
 * @param context - Extracted context
 * @returns Array of assumptions made during extraction
 */
function buildAssumptions<TContext>(
  state: InterviewState,
  context: TContext,
): Assumption[] {
  const assumptions: Assumption[] = [];

  // Compare currentContext (from answers) with final context (from extractor)
  // Any field in context not explicitly in answers is an assumption
  const contextObj = context as Record<string, unknown>;

  for (const [field, value] of Object.entries(contextObj)) {
    if (value === undefined || value === null) continue;

    // Check if this value was explicitly provided in an answer
    const explicitlyProvided = state.answers.some((a) =>
      a.text.toLowerCase().includes(String(value).toLowerCase()),
    );

    if (!explicitlyProvided) {
      assumptions.push({
        field,
        value,
        confidence: 0.6, // Lower confidence for inferred values
        source: "inferred",
      });
    }
  }

  return assumptions;
}
