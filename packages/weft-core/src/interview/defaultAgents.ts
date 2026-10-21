/**
 * @fileoverview Schema-driven default agent generation
 * @description Generates evaluator, questioner, and extractor from Zod schema
 * @module @symplek/core/interview/defaultAgents
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[Symplek-interview]: Schema-driven agent generation
 */

import { z } from "zod";
import { AgentUnit } from "../AgentUnit";
import { SymplekError } from "../errors";
import type {
  Answer,
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
 * What `analyzeSchema` needs to know about one schema node: what kind it is
 * and, for a wrapper (optional, nullable, default), what it wraps.
 *
 * Read from the schema's own definition object, not with `instanceof` against
 * the installed Zod's classes. A project can hold both generations at once
 * (`zod@3.25` ships Zod 4 under `zod/v4`, and Zod 4 has no `ZodNativeEnum` at
 * all), so class identity gives the wrong answer or throws; the definition
 * object is present on every schema of either generation.
 */
function describeNode(node: unknown): { kind: string; inner?: unknown } {
  // Zod 4: `_zod.def.type` is a lowercase kind; wrappers carry `innerType`.
  const def4 = (
    node as { _zod?: { def?: { type?: unknown; innerType?: unknown } } } | null
  )?._zod?.def;
  if (typeof def4?.type === "string") {
    return { kind: def4.type, inner: def4.innerType };
  }
  // Zod 3: `_def.typeName` is "ZodString" and so on; wrappers carry `innerType`.
  const def3 = (
    node as { _def?: { typeName?: unknown; innerType?: unknown } } | null
  )?._def;
  if (typeof def3?.typeName === "string") {
    return {
      kind: def3.typeName.replace(/^Zod/, "").toLowerCase(),
      inner: def3.innerType,
    };
  }
  return { kind: "unknown" };
}

/** The type names `AnalyzedField.type` has always reported, by node kind. */
const FIELD_TYPE_NAMES: Record<string, string> = {
  string: "ZodString",
  number: "ZodNumber",
  boolean: "ZodBoolean",
  bigint: "ZodBigInt",
  date: "ZodDate",
  array: "ZodArray",
  object: "ZodObject",
  enum: "ZodEnum",
  nativeenum: "ZodNativeEnum",
  union: "ZodUnion",
  literal: "ZodLiteral",
  tuple: "ZodTuple",
  record: "ZodRecord",
  null: "ZodNull",
  undefined: "ZodUndefined",
  any: "ZodAny",
  unknown: "ZodUnknown",
};

export function analyzeSchema<T>(schema: z.ZodType<T>): AnalyzedField[] {
  const fields: AnalyzedField[] = [];

  if (describeNode(schema).kind !== "object") {
    return fields;
  }

  // `.shape` is public on an object schema in both Zod 3 and Zod 4.
  const shape = (schema as unknown as { shape: Record<string, unknown> }).shape;

  for (const [name, field] of Object.entries(shape)) {
    const outer = describeNode(field);

    const isOptional = outer.kind === "optional" || outer.kind === "nullable";
    const hasDefault = outer.kind === "default";
    const isRequired = !isOptional && !hasDefault;

    // One level of wrapper is unwrapped, as before: the type reported for
    // `z.string().optional()` is the string's.
    const inner = isOptional || hasDefault ? describeNode(outer.inner) : outer;

    // `.description` is set by `.describe()` and lives on the outer schema.
    const description = (field as { description?: string }).description;

    // Calculate weight based on required/default status
    // Required fields without defaults are most important
    const weight = isRequired ? 15 : hasDefault ? 10 : 5;

    fields.push({
      name,
      type: FIELD_TYPE_NAMES[inner.kind] ?? "unknown",
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
// FIELD VALUE EXTRACTION HELPER
// =============================================================================

/**
 * Extract the most likely field value from raw answer text.
 *
 * @remarks
 * Strategy (in priority order):
 * 1. For email-type fields (by name convention): pull the first email address
 *    found in the text via regex. Answers like "My email is john@test.com"
 *    produce "john@test.com", not the full sentence.
 * 2. For all fields: look for "<fieldName> is <value>" or "<fieldName>: <value>"
 *    patterns and extract the value portion. "My name is John" → "John".
 * 3. Generic "… is <value>" at end of answer: "The answer is 42" → "42".
 * 4. Fall back to the full trimmed answer text.
 *
 * This is intentionally conservative — production callers should override the
 * extractor with LLM-powered extraction for complex schemas.
 *
 * @internal
 */
function extractFieldValue(fieldName: string, answerText: string): string {
  const trimmed = answerText.trim();

  // Strategy 1: email-looking field → grab first email-pattern substring
  if (fieldName.toLowerCase().includes("email")) {
    const emailMatch = trimmed.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    );
    if (emailMatch) return emailMatch[0];
  }

  // Strategy 2: "<fieldName> is <value>" / "<fieldName>: <value>"
  // Field names come from the caller's schema keys, which may contain regex
  // metacharacters (`z.object({ "name(": ... })`), so escape before interpolating.
  const fieldPattern = new RegExp(
    `${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+is|:)\\s+(.+)`,
    "i",
  );
  const fieldMatch = trimmed.match(fieldPattern);
  if (fieldMatch) return fieldMatch[1].trim();

  // Strategy 3: generic "… is <value>" at end of answer
  const genericIs = /\bis\s+(.+)$/i;
  const genericMatch = trimmed.match(genericIs);
  if (genericMatch) return genericMatch[1].trim();

  // Strategy 4: full text
  return trimmed;
}

// =============================================================================
// ANSWER LOOKUP HELPERS
// =============================================================================

/**
 * Build a lookup from field name → set of question IDs that target that field.
 * Enables extraction to find answers via question-field association rather than
 * text matching, so terse answers ("Alice") populate the correct schema field.
 *
 * @internal
 */
function buildFieldQuestionMap(
  askedQuestions: Question[] | undefined,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!askedQuestions) return map;
  for (const q of askedQuestions) {
    if (q.targetField) {
      const existing = map.get(q.targetField) ?? new Set<string>();
      existing.add(q.id);
      map.set(q.targetField, existing);
    }
  }
  return map;
}

/**
 * Find the most recent answer for a schema field.
 *
 * Primary signal: question-field association — the answer's `questionId` maps
 * to a question whose `targetField` is this field. This correctly handles terse
 * answers ("Alice") that contain no field-name keywords.
 *
 * Fallback: text matching — the answer text contains the field name. This covers
 * volunteered information not elicited by a targeted question.
 *
 * Scans in reverse so the most recent answer wins (correction semantics).
 *
 * @internal
 */
function findRelevantAnswer(
  answers: Answer[],
  fieldName: string,
  fieldQuestionIds: Map<string, Set<string>>,
): Answer | undefined {
  // Both signals are scanned in one reverse pass so the genuinely most recent
  // answer wins. Checking association first as a separate pass would return an
  // older targeted answer in preference to a newer volunteered correction,
  // contradicting the correction semantics this function promises.
  const questionIds = fieldQuestionIds.get(fieldName);
  if (questionIds && questionIds.size > 0) {
    const mostRecent = [...answers]
      .reverse()
      .find(
        (a) =>
          questionIds.has(a.questionId) ||
          a.text.toLowerCase().includes(fieldName.toLowerCase()),
      );
    if (mostRecent) return mostRecent;
  }
  // Fallback: text matching for volunteered info or when askedQuestions absent
  return [...answers].reverse().find((a) =>
    a.text.toLowerCase().includes(fieldName.toLowerCase()),
  );
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
 * 2. Extract the field value using type-aware heuristics (email regex,
 *    "field is value" patterns, generic "is value" patterns, full text)
 * 3. Validate the complete set against the schema with `safeParse()`
 *
 * Contract: this extractor produces a fully schema-valid result or throws
 * `VALIDATION_ERROR`. It is intended for FINAL extraction after the interview
 * loop. For incremental mid-loop context accumulation (partial data), use
 * `createPartialContextUpdater` instead.
 *
 * Note: This is a best-effort heuristic implementation. Production use cases
 * with complex schemas or free-form conversational answers should override
 * with LLM-powered extraction.
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

      // Map answers to fields using type-aware value extraction.
      // In production, this would use an LLM for intelligent extraction.
      //
      // Primary signal: question-field association — use the answer that was
      // given in response to the question targeting this field.  This handles
      // terse answers ("Alice") that contain no field-name keywords.
      // Fallback: text matching for volunteered information.
      //
      // Fix 6 (R2 verdict): scan from the most recent answer so a correction
      // later in the conversation overrides an earlier mention.
      // R3 fix: only overwrite an accumulated valid value when the candidate
      // passes per-field validation (guards against malformed corrections).
      const schemaAsObject = schema as unknown as z.AnyZodObject;
      const fieldSchemas: Record<string, z.ZodTypeAny> | null =
        typeof schemaAsObject.shape === "object"
          ? (schemaAsObject.shape as Record<string, z.ZodTypeAny>)
          : null;

      const fieldQuestionIds = buildFieldQuestionMap(state.askedQuestions);

      for (const field of fields) {
        const relevantAnswer = findRelevantAnswer(
          state.answers,
          field.name,
          fieldQuestionIds,
        );

        if (relevantAnswer) {
          const candidate = extractFieldValue(field.name, relevantAnswer.text);
          if (fieldSchemas?.[field.name]) {
            // Validate against the field's own schema before overwriting.
            const fieldResult = (fieldSchemas[field.name] as z.ZodTypeAny).safeParse(candidate);
            if (fieldResult.success) {
              extracted[field.name] = fieldResult.data;
            }
            // else: leave the accumulated value already in `extracted`
          } else {
            // Non-ZodObject schema: no per-field schema available, apply as-is.
            extracted[field.name] = candidate;
          }
        }
      }

      // Validate and parse through schema
      const result = schema.safeParse(extracted);

      if (result.success) {
        return result.data;
      }

      // N64 fix: fail loudly instead of returning schema-invalid partial data
      // cast as T. The InterviewResult<TContext>.context type documents
      // "validated at extraction time" — returning an invalid value silently
      // violates that contract.
      const issuesSummary = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new SymplekError({
        code: "VALIDATION_ERROR",
        why: `Interview extractor failed schema validation: ${issuesSummary}`,
        action:
          "Ensure the interview collects enough information to satisfy all required schema fields, or make optional fields nullable/optional in the schema.",
        context: { issues: result.error.issues, extractedKeys: Object.keys(extracted) },
      });
    });
  };
}

// =============================================================================
// PARTIAL CONTEXT UPDATER (mid-loop incremental accumulation)
// =============================================================================

/**
 * Creates a lightweight partial context updater for use between interview rounds.
 *
 * @remarks
 * Unlike `createDefaultExtractor`, this function does NOT require the full schema
 * to be satisfied. It extracts whatever field values it can find in the current
 * answers, validates each field individually by running the whole extracted set
 * through a schema.partial(), and returns the result as a plain Record.
 *
 * This is the correct tool for mid-loop context accumulation: after each answer
 * is collected, the evaluator needs to see the accumulated context so it can
 * credit answered fields and raise the clarity score incrementally. Running the
 * full strict extractor mid-loop throws for missing required fields (expected at
 * that stage), and swallowing that error means the context never updates.
 *
 * Contract: returns a `Record<string, unknown>` — not a fully-typed T — because
 * required fields may be absent. Callers must treat this as partial state only;
 * the final result is produced by the strict extractor after the loop ends.
 *
 * @param schema - Zod schema defining the target context
 * @returns A synchronous function that returns a partial context record
 */
export function createPartialContextUpdater<T>(
  schema: z.ZodType<T>,
): (state: InterviewState) => Record<string, unknown> {
  const fields = analyzeSchema(schema);

  return (state: InterviewState): Record<string, unknown> => {
    const extracted: Record<string, unknown> = { ...state.currentContext };

    // Primary signal: question-field association (enables terse answers).
    // Fallback: text matching for volunteered information.
    // Fix 5+6 (R2 verdict): scan from most recent answer; correction wins.
    const fieldQuestionIds = buildFieldQuestionMap(state.askedQuestions);
    for (const field of fields) {
      const relevantAnswer = findRelevantAnswer(
        state.answers,
        field.name,
        fieldQuestionIds,
      );
      if (relevantAnswer) {
        extracted[field.name] = extractFieldValue(field.name, relevantAnswer.text);
      }
    }

    // Use schema.partial() if the schema exposes it (ZodObject does), otherwise
    // fall back to the previously accumulated valid state. This filters out fields
    // whose values fail their individual type constraints (e.g. a malformed email).
    // Cast through unknown: ZodType<T> and AnyZodObject don't overlap in the type
    // system even though ZodObject<S,D,O> extends ZodType<O>. The runtime guard
    // (typeof .partial === "function") is the actual safety check.
    const schemaAsObject = schema as unknown as z.AnyZodObject;
    const partialSchema =
      typeof schemaAsObject.partial === "function"
        ? schemaAsObject.partial()
        : null;

    if (partialSchema) {
      const result = partialSchema.safeParse(extracted);
      if (result.success) {
        // Remove undefined entries from the parsed result so they don't shadow
        // previously accumulated values in state.currentContext.
        return Object.fromEntries(
          Object.entries(result.data as Record<string, unknown>).filter(
            ([, v]) => v !== undefined,
          ),
        );
      }

      // Fix 5 (R2 verdict): partial validation failed for one or more fields.
      // Return ONLY the subset that passes per-field type checks — never return
      // raw extracted values, which would allow a malformed answer to poison
      // currentContext and block a later correct answer from being accepted.
      const validFields: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(schemaAsObject.shape as Record<string, z.ZodTypeAny>)) {
        if (extracted[key] !== undefined) {
          const fieldResult = (fieldSchema as z.ZodTypeAny).safeParse(extracted[key]);
          if (fieldResult.success) {
            validFields[key] = fieldResult.data;
          }
        }
      }
      return validFields;
    }

    // partialSchema is null (schema is not a ZodObject): cannot safely validate
    // individual fields. Return only the previously accumulated valid context
    // rather than the raw extracted which may include type-invalid values.
    return { ...state.currentContext };
  };
}
