/**
 * @fileoverview Interview - Lazy configuration holder for interview operator
 * @description Validates configuration and holds interview setup until execution
 * @module weft-core/interview/Interview
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[Weft-interview]: Interview class for human-in-the-loop Q&A
 */

import type { z } from "zod";
import {
  createDefaultEvaluator,
  createDefaultExtractor,
  createDefaultQuestioner,
  createPartialContextUpdater,
} from "./defaultAgents";
import type {
  EvaluatorAgent,
  ExtractorAgent,
  InterviewConfig,
  InterviewOptions,
  QuestionerAgent,
} from "./types";

/**
 * Interview<TContext> - Lazy configuration holder for adaptive Q&A.
 *
 * @remarks
 * Interview is lazy - it does NOT execute until `.conduct()` is called
 * on the resulting AgentUnit. This maintains Weft's algebraic philosophy.
 *
 * @typeParam TContext - The target context schema type
 *
 * @example
 * ```typescript
 * const interview = Interview.create({
 *   contextSchema: ProjectContextSchema,
 *   options: { clarityThreshold: 70, maxQuestions: 10 },
 * });
 * ```
 */
export class Interview<TContext> {
  /**
   * Target schema for extracted context.
   * Used for validation and default agent generation.
   */
  readonly contextSchema: z.ZodType<TContext>;

  /**
   * Fully resolved options with defaults applied.
   */
  readonly options: Required<InterviewOptions>;

  /**
   * Clarity evaluator agent.
   * Scores current interview state (0-100).
   */
  readonly evaluator: EvaluatorAgent;

  /**
   * Question generator agent.
   * Returns next question or null if done.
   */
  readonly questioner: QuestionerAgent;

  /**
   * Context extractor agent.
   * Extracts TContext from interview state.
   * Called once after the interview loop for final, schema-validated extraction.
   */
  readonly extractor: ExtractorAgent<TContext>;

  /**
   * Lightweight partial context updater.
   * Called after each answer during the interview loop to accumulate extracted
   * field values without requiring the full schema to be satisfied. This lets the
   * evaluator credit answered fields in subsequent rounds so clarity can climb.
   *
   * Returns a `Record<string, unknown>` — not a fully typed TContext — because
   * required fields may still be missing at that point in the interview.
   */
  readonly partialContextUpdater: (state: import("./types").InterviewState) => Record<string, unknown>;

  /**
   * Private constructor - use Interview.create() factory method.
   * @param config - Interview configuration
   */
  private constructor(config: InterviewConfig<TContext>) {
    this.contextSchema = config.contextSchema;

    // Apply defaults to options
    this.options = {
      clarityThreshold: config.options?.clarityThreshold ?? 70,
      maxQuestions: config.options?.maxQuestions ?? 10,
      requiredFields: config.options?.requiredFields ?? [],
      isDone: config.options?.isDone ?? (() => false),
    };

    // Use custom agents or generate from schema
    this.evaluator =
      config.evaluator ?? createDefaultEvaluator(this.contextSchema);
    this.questioner =
      config.questioner ?? createDefaultQuestioner(this.contextSchema);
    this.extractor =
      config.extractor ?? createDefaultExtractor(this.contextSchema);
    this.partialContextUpdater = createPartialContextUpdater(this.contextSchema);

    // Validate at creation time
    this.validateConfig();
  }

  /**
   * Factory method to create Interview instance.
   *
   * @param config - Interview configuration
   * @returns New Interview instance
   *
   * @example
   * ```typescript
   * const interview = Interview.create({
   *   contextSchema: ProjectContextSchema,
   *   options: { clarityThreshold: 80 },
   * });
   * ```
   */
  static create<TContext>(
    config: InterviewConfig<TContext>,
  ): Interview<TContext> {
    return new Interview<TContext>(config);
  }

  /**
   * Validate configuration at creation time.
   * Throws immediately for invalid options.
   *
   * @throws Error if configuration is invalid
   */
  private validateConfig(): void {
    // Validate contextSchema is present and is a Zod type
    if (
      this.contextSchema === undefined ||
      this.contextSchema === null ||
      typeof this.contextSchema !== "object" ||
      typeof (this.contextSchema as { parse?: unknown }).parse !== "function"
    ) {
      throw new Error(
        "Interview config error: contextSchema is required and must be a Zod schema",
      );
    }

    // Validate clarity threshold (0-100)
    if (
      this.options.clarityThreshold < 0 ||
      this.options.clarityThreshold > 100
    ) {
      throw new Error(
        `Interview config error: clarityThreshold must be 0-100, got ${this.options.clarityThreshold}`,
      );
    }

    // Validate maxQuestions (>= 1)
    if (this.options.maxQuestions < 1) {
      throw new Error(
        `Interview config error: maxQuestions must be >= 1, got ${this.options.maxQuestions}`,
      );
    }

    // Validate isDone is a function
    if (typeof this.options.isDone !== "function") {
      throw new Error(
        `Interview config error: isDone must be a function, got ${typeof this.options.isDone}`,
      );
    }

    // Validate requiredFields is an array
    if (!Array.isArray(this.options.requiredFields)) {
      throw new Error(
        `Interview config error: requiredFields must be an array, got ${typeof this.options.requiredFields}`,
      );
    }
  }
}
