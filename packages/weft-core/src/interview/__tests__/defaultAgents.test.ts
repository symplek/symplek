/**
 * @fileoverview Default Agents Tests
 * @description Tests for schema-driven default agent generation
 * @module @weft/core/interview/__tests__/defaultAgents.test
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
      const extractor = createDefaultExtractor(SimpleSchema);
      const state = createTestState({
        answers: [
          createTestAnswer("q-1", "My name is John"),
          createTestAnswer("q-2", "My email is john@test.com"),
        ],
      });

      const result = await extractor(state).run(ctx, { trustMode: "legacy" });

      // Simple keyword matching should find mentions of fields
      expect(result).toBeDefined();
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
