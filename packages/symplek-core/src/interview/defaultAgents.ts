/**
 * @fileoverview Schema-driven default agent generation
 * @description Generates evaluator, questioner, and extractor from Zod schema
 * @module @symplek/core/interview/defaultAgents
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Symplek-interview]: Schema-driven agent generation
 */

import { z } from "zod";
import { AgentUnit } from "../AgentUnit";
import type {
  ClarityScore,
  EvaluatorAgent,
  ExtractorAgent,
  InterviewState,
  Question,
  QuestionerAgent,
} from "./types";

// =============================================================================
// SCHEMA ANALYSIS
// =============================================================================

/**
 * Analyzed field from a Zod schema.
 * Used for generating default agents.
 */
export interface AnalyzedField {
  /** Field name from the schema */
  name: string;
  /** Zod type name (e.g., "ZodString", "ZodNumber") */
  type: string;
  /** Description from .describe() if set */
  description?: string;
  /** True if field is required (not optional or defaulted) */
  isRequired: boolean;
  /** True if field has a default value */
  hasDefault: boolean;
  /** Weight for clarity scoring (higher = more important) */
  weight: number;
}

/**
 * Parse a Zod schema to extract field metadata.
 * Used for generating default agents.
 *
 * @param schema - Zod schema to analyze
 * @returns Array of analyzed fields
 *
 * @example
 * ```typescript
 * const fields = analyzeSchema(ProjectContextSchema);
 * // [{ name: 'name', type: 'ZodString', isRequired: true, weight: 15 }, ...]
 * ```
 */
/**
 * Derive a stable Zod class-name string from a field schema using only public
 * Zod v3 `instanceof` checks.  Mirrors the strings previously read from
 * `._def.typeName` so downstream consumers receive identical values.
 *
 * @param field - Any Zod type (already unwrapped of Optional/Nullable/Default)
 * @returns Class-name string (e.g. "ZodString") or "unknown"
 */
function zodTypeName(field: z.ZodTypeAny): string {
  if (field instanceof z.ZodString) return "ZodString";
  if (field instanceof z.ZodNumber) return "ZodNumber";
  if (field instanceof z.ZodBoolean) return "ZodBoolean";
  if (field instanceof z.ZodBigInt) return "ZodBigInt";
  if (field instanceof z.ZodDate) return "ZodDate";
  if (field instanceof z.ZodArray) return "ZodArray";
  if (field instanceof z.ZodObject) return "ZodObject";
  if (field instanceof z.ZodEnum) return "ZodEnum";
  if (field instanceof z.ZodNativeEnum) return "ZodNativeEnum";
  if (field instanceof z.ZodUnion) return "ZodUnion";
  if (field instanceof z.ZodLiteral) return "ZodLiteral";
  if (field instanceof z.ZodTuple) return "ZodTuple";
  if (field instanceof z.ZodRecord) return "ZodRecord";
  if (field instanceof z.ZodNull) return "ZodNull";
  if (field instanceof z.ZodUndefined) return "ZodUndefined";
  if (field instanceof z.ZodAny) return "ZodAny";
  if (field instanceof z.ZodUnknown) return "ZodUnknown";
  return "unknown";
}

export function analyzeSchema<T>(schema: z.ZodType<T>): AnalyzedField[] {
  const fields: AnalyzedField[] = [];

  // Use public instanceof check instead of ._def.typeName
  if (!(schema instanceof z.ZodObject)) {
    return fields;
  }

  // .shape is a public Zod v3 API (documented in the Zod README)
  const shape = schema.shape;

  for (const [name, rawField] of Object.entries(shape)) {
    let field = rawField as z.ZodTypeAny;

    // Determine wrapper kind using public instanceof checks
    const isOptional =
      field instanceof z.ZodOptional || field instanceof z.ZodNullable;
    const hasDefault = field instanceof z.ZodDefault;
    const isRequired = !isOptional && !hasDefault;

    // Unwrap to the inner type using public Zod v3 APIs:
    //   ZodOptional.unwrap()  — documented public API
    //   ZodNullable.unwrap()  — documented public API
    //   ZodDefault.removeDefault() — documented public API
    let innerField: z.ZodTypeAny = field;
    if (field instanceof z.ZodOptional) {
      innerField = field.unwrap();
    } else if (field instanceof z.ZodNullable) {
      innerField = field.unwrap();
    } else if (field instanceof z.ZodDefault) {
      innerField = field.removeDefault();
    }

    // .description is a public property on ZodType (set by .describe())
    // It lives on the *outer* type (the wrapper carries the description).
    const description = field.description;

    const typeName = zodTypeName(innerField);

    // Calculate weight based on required/default status
    // Required fields without defaults are most important
    const weight = isRequired ? 15 : hasDefault ? 10 : 5;

    fields.push({
      name,
      type: typeName,
      description,
      isRequired,
      hasDefault,
      weight,
    });
  }

  return fields;
}

// =============================================================================
// DEFAULT EVALUATOR
// =============================================================================

/**
 * Creates a default clarity evaluator from schema.
 *
 * @remarks
 * Algorithm:
 * 1. Parse schema to get field weights
 * 2. For each field, score based on:
 *    - Is the field populated in currentContext? (+weight)
 *    - Is the field mentioned in answers? (+weight/2)
 * 3. Aggregate to overall score (0-100)
 *
 * @param schema - Zod schema defining the target context
 * @returns Evaluator agent function
 *
 * @example
 * ```typescript
 * const evaluator = createDefaultEvaluator(ProjectContextSchema);
 * const score = await evaluator(state).run(ctx);
 * // { overall: 65, byField: { name: 100, budget: 30 }, missingCritical: ['deadline'] }
 * ```
 */
export function createDefaultEvaluator<T>(
  schema: z.ZodType<T>,
): EvaluatorAgent {
  const fields = analyzeSchema(schema);
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);

  return (state: InterviewState): AgentUnit<ClarityScore> => {
    return AgentUnit.from(async () => {
      const byField: Record<string, number> = {};
      const missingCritical: string[] = [];
      let earnedWeight = 0;

      for (const field of fields) {
        const value = state.currentContext[field.name];
        const hasValue = value !== undefined && value !== null && value !== "";

        // Check if any answer mentions this field or related keywords
        const mentionedInAnswers = state.answers.some(
          (a) =>
            a.text.toLowerCase().includes(field.name.toLowerCase()) ||
            (field.description &&
              a.text.toLowerCase().includes(field.description.toLowerCase())),
        );

        let fieldScore = 0;
        if (hasValue) {
          fieldScore = 100;
          earnedWeight += field.weight;
        } else if (mentionedInAnswers) {
          fieldScore = 50;
          earnedWeight += field.weight * 0.5;
        }

        byField[field.name] = fieldScore;

        // Track critically missing required fields
        if (field.isRequired && !hasValue) {
          missingCritical.push(field.name);
        }
      }

      const overall = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

      return {
        overall: Math.round(overall),
        byField,
        missingCritical,
      };
    });
  };
}

// =============================================================================
// DEFAULT QUESTIONER
// =============================================================================

/**
 * Creates a default question generator from schema.
 *
 * @remarks
 * Algorithm:
 * 1. Get fields sorted by (weight × (100 - fieldClarity))
 * 2. Select the highest-priority field not yet at 100% clarity
 * 3. Generate a question targeting that field
 * 4. Return null if all fields are at 100% clarity
 *
 * @param schema - Zod schema defining the target context
 * @returns Questioner agent function
 *
 * @example
 * ```typescript
 * const questioner = createDefaultQuestioner(ProjectContextSchema);
 * const question = await questioner(state, clarity).run(ctx);
 * // { id: 'q-1-budget', text: 'What is the budget?', targetField: 'budget', priority: 'high' }
 * ```
 */
export function createDefaultQuestioner<T>(
  schema: z.ZodType<T>,
): QuestionerAgent {
  const fields = analyzeSchema(schema);

  return (
    state: InterviewState,
    clarity: ClarityScore,
  ): AgentUnit<Question | null> => {
    return AgentUnit.from(async () => {
      // Prioritize fields by (weight × gap)
      const prioritizedFields = fields
        .map((field) => ({
          field,
          score: clarity.byField[field.name] ?? 0,
          gap: 100 - (clarity.byField[field.name] ?? 0),
          priority: field.weight * (100 - (clarity.byField[field.name] ?? 0)),
        }))
        .filter((f) => f.gap > 0)
        .sort((a, b) => b.priority - a.priority);

      if (prioritizedFields.length === 0) {
        // All fields at 100% clarity
        return null;
      }

      const target = prioritizedFields[0];
      const field = target.field;

      // Generate question text
      const questionText = generateQuestionText(field, state);

      const question: Question = {
        id: `q-${state.round}-${field.name}`,
        text: questionText,
        targetField: field.name,
        priority: field.isRequired ? "high" : "medium",
      };
      return question;
    });
  };
}

/**
 * Generate natural question text for a field.
 * Uses field description if available, otherwise humanizes the field name.
 *
 * @param field - The field to generate a question for
 * @param state - Current interview state (used for variety)
 * @returns Natural language question text
 */
function generateQuestionText(
  field: AnalyzedField,
  state: InterviewState,
): string {
  // Use description if available
  if (field.description) {
    return `Could you tell me about ${field.description.toLowerCase()}?`;
  }

  // Generate based on field name - humanize camelCase
  const humanizedName = field.name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
    .toLowerCase();

  // Vary question style based on round for natural conversation
  const prefixes = [
    `What is the ${humanizedName}?`,
    `Can you describe the ${humanizedName}?`,
    `Tell me about the ${humanizedName}.`,
    `What would you like the ${humanizedName} to be?`,
  ];

  return prefixes[state.round % prefixes.length];
}

// =============================================================================
// DEFAULT EXTRACTOR
// =============================================================================

/**
 * Creates a default context extractor from schema.
 *
 * @remarks
 * Algorithm:
 * 1. For each schema field, search answers for relevant content
 * 2. Extract/infer values with keyword matching
 * 3. Validate against schema with `safeParse()`
 *
 * Note: This is a basic implementation using keyword matching.
 * Production use cases may want to override with LLM-powered extraction.
 *
 * @param schema - Zod schema defining the target context
 * @returns Extractor agent function
 *
 * @example
 * ```typescript
 * const extractor = createDefaultExtractor(ProjectContextSchema);
 * const context = await extractor(state).run(ctx);
 * // { name: 'My Project', budget: 50000, ... }
 * ```
 */
export function createDefaultExtractor<T>(
  schema: z.ZodType<T>,
): ExtractorAgent<T> {
  const fields = analyzeSchema(schema);

  return (state: InterviewState): AgentUnit<T> => {
    return AgentUnit.from(async () => {
      const extracted: Record<string, unknown> = { ...state.currentContext };

      // Map answers to fields (simple keyword matching for default)
      // In production, this would use an LLM for intelligent extraction
      for (const field of fields) {
        if (extracted[field.name] === undefined) {
          // Find answers that might relate to this field
          const relevantAnswer = state.answers.find((a) =>
            a.text.toLowerCase().includes(field.name.toLowerCase()),
          );

          if (relevantAnswer) {
            // Simple extraction: use the answer text
            // Real implementation would use LLM parsing
            extracted[field.name] = relevantAnswer.text;
          }
        }
      }

      // Validate and parse through schema
      const result = schema.safeParse(extracted);

      if (result.success) {
        return result.data;
      }

      // If validation fails, return what we have (partial context)
      // The Interview class should handle this gracefully
      return extracted as T;
    });
  };
}
