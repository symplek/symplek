/**
 * @fileoverview Default Agents Tests
 * @description Tests for schema-driven default agent generation
 * @module weft-core/interview/__tests__/defaultAgents.test
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Weft-interview-operator]: Story 03-03 - Default Agents Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createContext } from "../../index";
import type { AgentContext } from "../../types";
import {
  analyzeSchema,
  createDefaultEvaluator,
  createDefaultExtractor,
  createDefaultQuestioner,
  createPartialContextUpdater,
} from "../defaultAgents";
import type { Answer, ClarityScore, InterviewState } from "../types";

// =============================================================================
// TEST SCHEMAS
// =============================================================================

const SimpleSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

const ComplexSchema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number().optional(),
  }),
  preferences: z.array(z.string()),
});

const OptionalSchema = z.object({
  required: z.string(),
  optional: z.string().optional(),
  withDefault: z.string().default("default"),
});

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a test interview state.
 */
function createTestState(
  overrides: Partial<InterviewState> = {},
): InterviewState {
  return {
    answers: [],
    currentContext: {},
    clarityHistory: [],
    round: 1,
    initialInput: "test input",
    ...overrides,
  };
}

/**
 * Create a test answer.
 */
function createTestAnswer(questionId: string, text: string): Answer {
  return {
    questionId,
    text,
    timestamp: Date.now(),
  };
}

describe("Default Agents Tests", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // EVALUATOR GENERATION (4 tests)
  // ===========================================================================

  describe("Evaluator Generation", () => {
    it("createDefaultEvaluator creates valid evaluator", async () => {
      const evaluator = createDefaultEvaluator(SimpleSchema);
      const state = createTestState();

      const result = await evaluator(state).run(ctx, { trustMode: "legacy" });

      expect(result).toHaveProperty("overall");
      expect(result).toHaveProperty("byField");
      expect(result).toHaveProperty("missingCritical");
      expect(typeof result.overall).toBe("number");
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });

    it("evaluator analyzes field completeness", async () => {
      const evaluator = createDefaultEvaluator(SimpleSchema);

      // State with no data
      const emptyState = createTestState();
      const emptyResult = await evaluator(emptyState).run(ctx, {
        trustMode: "legacy",
      });

      // State with data
      const populatedState = createTestState({
        currentContext: {
          name: "John",
          email: "john@example.com",
        },
      });
      const populatedResult = await evaluator(populatedState).run(ctx, {
        trustMode: "legacy",
      });

      expect(populatedResult.overall).toBeGreaterThan(emptyResult.overall);
    });

    it("evaluator weights required fields higher", async () => {
      const evaluator = createDefaultEvaluator(OptionalSchema);

      // Only optional field populated
      const optionalOnly = createTestState({
        currentContext: { optional: "value" },
      });
      const optionalResult = await evaluator(optionalOnly).run(ctx, {
        trustMode: "legacy",
      });

      // Only required field populated
      const requiredOnly = createTestState({
        currentContext: { required: "value" },
      });
      const requiredResult = await evaluator(requiredOnly).run(ctx, {
        trustMode: "legacy",
      });

      // Required field should contribute more to clarity
      expect(requiredResult.overall).toBeGreaterThan(optionalResult.overall);
    });

    it("evaluator analyzes answer quality", async () => {
      const evaluator = createDefaultEvaluator(SimpleSchema);

      // State with answers mentioning fields
      const stateWithAnswers = createTestState({
        answers: [
          createTestAnswer("q-1", "My name is John"),
          createTestAnswer("q-2", "Email is john@test.com"),
        ],
      });

      const result = await evaluator(stateWithAnswers).run(ctx, {
        trustMode: "legacy",
      });

      // Should have some clarity from answers mentioning fields
      expect(result.overall).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // QUESTIONER GENERATION (5 tests)
  // ===========================================================================

  describe("Questioner Generation", () => {
    it("createDefaultQuestioner creates valid questioner", async () => {
      const questioner = createDefaultQuestioner(SimpleSchema);
      const state = createTestState();
      const clarity: ClarityScore = {
        overall: 30,
        byField: { name: 0, email: 0 },
        missingCritical: ["name", "email"],
      };

      const result = await questioner(state, clarity).run(ctx, {
        trustMode: "legacy",
      });

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("targetField");
      expect(result).toHaveProperty("priority");
    });

    it("questioner targets lowest-clarity fields", async () => {
      const questioner = createDefaultQuestioner(SimpleSchema);
      const state = createTestState();

      // Name has high clarity, email has low
      const clarity: ClarityScore = {
        overall: 50,
        byField: { name: 100, email: 0 },
        missingCritical: ["email"],
      };

      const result = await questioner(state, clarity).run(ctx, {
        trustMode: "legacy",
      });

      expect(result?.targetField).toBe("email");
    });

    it("questioner prioritizes required fields", async () => {
      const questioner = createDefaultQuestioner(OptionalSchema);
      const state = createTestState();

      // All fields have same low clarity
      const clarity: ClarityScore = {
        overall: 0,
        byField: { required: 0, optional: 0, withDefault: 0 },
        missingCritical: ["required"],
      };

      const result = await questioner(state, clarity).run(ctx, {
        trustMode: "legacy",
      });

      // Should prioritize required field (has higher weight)
      expect(result?.targetField).toBe("required");
      expect(result?.priority).toBe("high");
    });

    it("questioner returns null when all fields clear", async () => {
      const questioner = createDefaultQuestioner(SimpleSchema);
      const state = createTestState();

      // All fields at 100% clarity
      const clarity: ClarityScore = {
        overall: 100,
        byField: { name: 100, email: 100 },
        missingCritical: [],
      };

      const result = await questioner(state, clarity).run(ctx, {
        trustMode: "legacy",
      });

      expect(result).toBeNull();
    });

    it("schema field types affect question generation", async () => {
      const NumberSchema = z.object({
        quantity: z.number(),
        price: z.number(),
      });

      const questioner = createDefaultQuestioner(NumberSchema);
      const state = createTestState({ round: 1 });
      const clarity: ClarityScore = {
        overall: 0,
        byField: { quantity: 0, price: 0 },
        missingCritical: ["quantity", "price"],
      };

      const result = await questioner(state, clarity).run(ctx, {
        trustMode: "legacy",
      });

      // Should generate a question
      expect(result).not.toBeNull();
      expect(result?.text).toBeDefined();
    });
  });

  // ===========================================================================
  // EXTRACTOR GENERATION (4 tests)
  // ===========================================================================

  describe("Extractor Generation", () => {
    it("createDefaultExtractor creates valid extractor", async () => {
      const extractor = createDefaultExtractor(SimpleSchema);
      const state = createTestState({
        currentContext: { name: "John", email: "john@example.com" },
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
    });

    it("extractor maps answers to schema fields", async () => {
      // The extractor must parse field values from realistic natural-language answers.
      // "My name is John"          → name:  "John"       (not the full sentence)
      // "My email is john@test.com" → email: "john@test.com" (not the full sentence)
      //
      // This test was previously weakened by removing the answers and supplying a
      // pre-populated context, which meant the answer-to-field mapping path was never
      // exercised. It is restored here in accordance with rule 015: fix the product,
      // not the test.
      const extractor = createDefaultExtractor(SimpleSchema);
      const state = createTestState({
        answers: [
          createTestAnswer("q-1", "My name is John"),
          createTestAnswer("q-2", "My email is john@test.com"),
        ],
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      expect(result).toBeDefined();
      expect(result.name).toBe("John");
      expect(result.email).toBe("john@test.com");
    });

    it("extractor handles missing fields with defaults", async () => {
      const SchemaWithDefaults = z.object({
        name: z.string(),
        count: z.number().default(0),
      });

      const extractor = createDefaultExtractor(SchemaWithDefaults);
      const state = createTestState({
        currentContext: { name: "Test" },
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      expect(result).toBeDefined();
      expect(result.name).toBe("Test");
    });

    it("extractor validates output against schema", async () => {
      const extractor = createDefaultExtractor(SimpleSchema);
      const state = createTestState({
        currentContext: { name: "Valid", email: "valid@example.com" },
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      // Should return validated data
      expect(result.name).toBe("Valid");
      expect(result.email).toBe("valid@example.com");
    });

    it("extractor throws VALIDATION_ERROR on incomplete required fields", async () => {
      // The extractor contract: throw for invalid/incomplete data so callers
      // know extraction failed rather than silently returning wrong-typed data.
      const extractor = createDefaultExtractor(SimpleSchema);
      const state = createTestState({
        // Only name, no email — schema requires both
        currentContext: { name: "John" },
      });

      await expect(
        extractor(state).run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // PARTIAL CONTEXT UPDATER (mid-loop accumulation)
  // ===========================================================================

  describe("Partial Context Updater", () => {
    it("createPartialContextUpdater accumulates fields without full schema validation", () => {
      // Mid-loop: only name answered so far, email still missing.
      // The partial updater must NOT throw even though email is required in SimpleSchema.
      const updater = createPartialContextUpdater(SimpleSchema);
      const state = createTestState({
        answers: [createTestAnswer("q-1", "My name is John")],
      });

      const partial = updater(state);

      // name extracted from the answer; email absent (not yet answered)
      expect(partial.name).toBe("John");
      expect(partial.email).toBeUndefined();
    });

    it("createPartialContextUpdater extracts email value from natural-language answer", () => {
      const updater = createPartialContextUpdater(SimpleSchema);
      const state = createTestState({
        answers: [
          createTestAnswer("q-1", "My name is Jane"),
          createTestAnswer("q-2", "My email is jane@example.com"),
        ],
      });

      const partial = updater(state);

      expect(partial.name).toBe("Jane");
      expect(partial.email).toBe("jane@example.com");
    });

    it("createPartialContextUpdater merges with existing currentContext", () => {
      const updater = createPartialContextUpdater(SimpleSchema);
      // Simulate state after first round: name already accumulated
      const state = createTestState({
        currentContext: { name: "Alice" },
        answers: [
          createTestAnswer("q-1", "My name is Alice"),
          createTestAnswer("q-2", "email: alice@test.org"),
        ],
      });

      const partial = updater(state);

      // Both fields should be present
      expect(partial.name).toBe("Alice");
      expect(partial.email).toBe("alice@test.org");
    });

    it("malformed answer does not poison context and a later corrected answer is accepted", () => {
      // Fix 5+6 (R2 adversarial verdict):
      // Round 1: malformed email must NOT enter the context.
      // Round 2: corrected email must be accepted, not blocked by a poisoned field.
      const updater = createPartialContextUpdater(SimpleSchema);

      // Round 1: malformed email in the only answer.
      const stateRound1 = createTestState({
        currentContext: {},
        answers: [createTestAnswer("q-1", "My email is not-an-email")],
      });
      const partialRound1 = updater(stateRound1);

      // Invalid email must NOT appear in the partial context.
      expect(partialRound1.email).toBeUndefined();

      // Round 2: corrected email arrives. Simulate state after round 1 accumulated
      // nothing for email (correct behaviour from round 1).
      const stateRound2 = createTestState({
        currentContext: partialRound1, // no email poisoning
        answers: [
          createTestAnswer("q-1", "My email is not-an-email"),
          createTestAnswer("q-2", "Correction, my email is correct@example.com"),
        ],
      });
      const partialRound2 = updater(stateRound2);

      // Corrected valid email must be accepted.
      expect(partialRound2.email).toBe("correct@example.com");
    });

    it("corrected answer replaces an earlier valid answer (most-recent scan)", () => {
      // Fix 6 (R2 adversarial verdict): extractor and partial updater must scan
      // from the most recent answer so a correction wins over the first mention.
      const updater = createPartialContextUpdater(SimpleSchema);

      const state = createTestState({
        currentContext: { email: "old@example.com" },
        answers: [
          createTestAnswer("q-1", "My email is old@example.com"),
          createTestAnswer("q-2", "Correction, my email is new@example.com"),
        ],
      });
      const partial = updater(state);

      // Most recent (corrected) answer must win.
      expect(partial.email).toBe("new@example.com");
    });

    it("createDefaultExtractor scans from most-recent answer so a correction wins", async () => {
      // Fix 6 (R2 adversarial verdict): extractor must return the most recent answer,
      // not the first one, when the transcript contains a correction.
      // Answers are kept to one field each so extractFieldValue resolves cleanly.
      const extractor = createDefaultExtractor(SimpleSchema);

      const state = createTestState({
        answers: [
          createTestAnswer("q-1", "My name is OldName"),
          createTestAnswer("q-2", "My email is old@example.com"),
          createTestAnswer("q-3", "Correction: my email is new@example.com"),
        ],
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      // Name came from the only name answer.
      expect(result.name).toBe("OldName");
      // Email must be the CORRECTED (most recent) value, not old@example.com.
      expect(result.email).toBe("new@example.com");
    });

    it("P3 — terse answers are extracted via question-field association", async () => {
      // Failure scenario (before fix): text matching requires the answer text
      // to contain the field name.  "Alice" does not contain "name", so the
      // extractor found nothing and threw VALIDATION_ERROR.
      //
      // After fix: when askedQuestions is populated, extraction uses the
      // question's targetField as the primary lookup signal.  A bare value like
      // "Alice" (in response to a question targeting "name") populates the field
      // correctly without any text-match heuristic.
      const extractor = createDefaultExtractor(SimpleSchema);
      const state: ReturnType<typeof createTestState> = createTestState({
        answers: [
          { questionId: "q-1", text: "Alice", timestamp: Date.now() },
          { questionId: "q-2", text: "alice@example.com", timestamp: Date.now() },
        ],
        askedQuestions: [
          { id: "q-1", text: "What is your name?", targetField: "name", priority: "high" as const },
          { id: "q-2", text: "What is your email?", targetField: "email", priority: "high" as const },
        ],
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      expect(result.name).toBe("Alice");
      expect(result.email).toBe("alice@example.com");
    });

    it("P2 — valid accumulated value survives a later malformed correction at final extraction", async () => {
      // Failure scenario (without R3 fix):
      // currentContext.email = "good@example.com" (valid, accepted by partial updater).
      // Most-recent answer says "My email is not-an-email" (malformed).
      // Without per-field validation, final extraction overwrites the accumulated
      // valid value with the invalid string, schema.safeParse() fails, and the
      // extractor throws VALIDATION_ERROR even though a valid value was available.
      //
      // With the fix: the candidate "not-an-email" fails ZodString.email(),
      // so extracted[field] is NOT overwritten. The accumulated valid value
      // from currentContext stands, and the full schema parse succeeds.
      const extractor = createDefaultExtractor(SimpleSchema);

      const state = createTestState({
        // Simulate a converged context accumulated through prior rounds.
        currentContext: { name: "Alice", email: "good@example.com" },
        answers: [
          createTestAnswer("q-1", "My name is Alice"),
          createTestAnswer("q-2", "My email is good@example.com"),
          // Latest answer: malformed correction that must NOT override the valid value.
          createTestAnswer("q-3", "My email is not-an-email"),
        ],
      });

      // Must succeed, not throw VALIDATION_ERROR.
      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      expect(result.name).toBe("Alice");
      // Accumulated valid email must survive the malformed mention.
      expect(result.email).toBe("good@example.com");
    });
  });

  // ===========================================================================
  // SCHEMA PARSING (4 tests)
  // ===========================================================================

  describe("Schema Parsing", () => {
    it("analyzeSchema parses Zod schema to extract metadata", () => {
      const fields = analyzeSchema(SimpleSchema);

      expect(fields.length).toBe(2);

      const nameField = fields.find((f) => f.name === "name");
      expect(nameField).toBeDefined();
      expect(nameField?.type).toBe("ZodString");
      expect(nameField?.isRequired).toBe(true);

      const emailField = fields.find((f) => f.name === "email");
      expect(emailField).toBeDefined();
      expect(emailField?.type).toBe("ZodString");
    });

    it("handles optional vs required fields", () => {
      const fields = analyzeSchema(OptionalSchema);

      const requiredField = fields.find((f) => f.name === "required");
      expect(requiredField?.isRequired).toBe(true);

      const optionalField = fields.find((f) => f.name === "optional");
      expect(optionalField?.isRequired).toBe(false);

      const defaultField = fields.find((f) => f.name === "withDefault");
      expect(defaultField?.hasDefault).toBe(true);
    });

    it("handles nested schemas", () => {
      // Note: Current implementation flattens to top level only
      // Nested objects are treated as single fields
      const fields = analyzeSchema(ComplexSchema);

      expect(fields.length).toBe(2);

      const userField = fields.find((f) => f.name === "user");
      expect(userField).toBeDefined();
      expect(userField?.type).toBe("ZodObject");

      const prefsField = fields.find((f) => f.name === "preferences");
      expect(prefsField).toBeDefined();
      expect(prefsField?.type).toBe("ZodArray");
    });

    it("handles array fields", () => {
      const ArraySchema = z.object({
        items: z.array(z.string()),
        tags: z.array(z.number()),
      });

      const fields = analyzeSchema(ArraySchema);

      const itemsField = fields.find((f) => f.name === "items");
      expect(itemsField).toBeDefined();
      expect(itemsField?.type).toBe("ZodArray");

      const tagsField = fields.find((f) => f.name === "tags");
      expect(tagsField).toBeDefined();
      expect(tagsField?.type).toBe("ZodArray");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R5 verdict — two deterministic extraction defects.
// ─────────────────────────────────────────────────────────────────────────────

describe("extraction robustness (R5 verdict)", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it("a later volunteered correction beats an earlier targeted answer", async () => {
    // The association signal must not be checked as a separate earlier pass:
    // doing so returns the older targeted answer and ignores the correction.
    const schema = z.object({ email: z.string().email() });
    const extractor = createDefaultExtractor(schema);

    const state = createTestState({
      askedQuestions: [
        { id: "q-1", text: "What is your email?", targetField: "email" },
        { id: "q-2", text: "Anything else?", targetField: "notes" },
      ],
      answers: [
        createTestAnswer("q-1", "old@example.com"),
        createTestAnswer("q-2", "Correction: my email is new@example.com"),
      ],
    } as Partial<InterviewState>);

    const result = await extractor(state).run(ctx, { trustMode: "legacy" });

    expect(result.email).toBe("new@example.com");
  });

  it("a schema key containing regex metacharacters does not crash extraction", async () => {
    // Field names are caller-supplied object keys and are interpolated into a
    // RegExp; an unescaped "(" produced a SyntaxError instead of a value.
    const schema = z.object({ "name(": z.string() });
    const extractor = createDefaultExtractor(schema);

    const state = createTestState({
      askedQuestions: [
        { id: "q-1", text: "What is your name(?", targetField: "name(" },
      ],
      answers: [createTestAnswer("q-1", "Alice")],
    } as Partial<InterviewState>);

    await expect(
      extractor(state).run(ctx, { trustMode: "legacy" }),
    ).resolves.toBeDefined();
  });
});
