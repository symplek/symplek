/**
 * @fileoverview Interview Configuration Tests
 * @description Tests for .interview() operator configuration and lazy evaluation
 * @module @symplek/core/interview/__tests__/interview.test
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Symplek-interview-operator]: Story 03-01 - Configuration Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentUnit, createContext } from "../../index";
import type { AgentContext } from "../../types";
import { Interview } from "../Interview";
import type { ClarityScore, InterviewState, Question } from "../types";

// =============================================================================
// TEST UTILITIES
// =============================================================================

const SimpleSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

const ComplexSchema = z.object({
  projectName: z.string(),
  budget: z.number().optional(),
  deadline: z.string().optional(),
});

/**
 * Create a mock evaluator that returns a fixed score.
 */
function mockEvaluator(score: number) {
  return (_state: InterviewState) =>
    AgentUnit.of<ClarityScore>({
      overall: score,
      byField: {},
      missingCritical: [],
    });
}

/**
 * Create a mock questioner that returns questions from a list, then null.
 */
function _mockQuestioner(questions: Question[]) {
  let index = 0;
  return (_state: InterviewState, _clarity: ClarityScore) =>
    AgentUnit.of<Question | null>(
      index < questions.length ? questions[index++] : null,
    );
}

/**
 * Create a mock extractor that returns a fixed context.
 */
function mockExtractor<T>(context: T) {
  return (_state: InterviewState) => AgentUnit.of<T>(context);
}

describe("Interview Configuration Tests", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // BASIC CONFIGURATION (4 tests)
  // ===========================================================================

  describe("Basic Configuration", () => {
    it(".interview() returns AgentUnit<InterviewPending<T>>", async () => {
      const unit = AgentUnit.of("Build a task app").interview({
        contextSchema: SimpleSchema,
      });

      // Verify it's an AgentUnit
      expect(unit).toBeInstanceOf(AgentUnit);

      // Run and verify the pending structure
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toHaveProperty("__interviewPending", true);
      expect(result).toHaveProperty("interview");
      expect(result).toHaveProperty("initialInput", "Build a task app");
    });

    it(".interview() is lazy (doesn't execute until .conduct())", async () => {
      const evaluatorSpy = vi.fn().mockReturnValue(
        AgentUnit.of<ClarityScore>({
          overall: 100,
          byField: {},
          missingCritical: [],
        }),
      );

      const unit = AgentUnit.of("test input").interview({
        contextSchema: SimpleSchema,
        evaluator: evaluatorSpy,
      });

      // Run interview() - evaluator should NOT be called yet
      await unit.run(ctx, { trustMode: "legacy" });

      expect(evaluatorSpy).not.toHaveBeenCalled();
    });

    it("config validation: schema required", () => {
      // @ts-expect-error - Testing missing schema validation
      expect(() => Interview.create({})).toThrow();
    });

    it("config validation: invalid clarityThreshold", () => {
      expect(() =>
        Interview.create({
          contextSchema: SimpleSchema,
          options: { clarityThreshold: 150 },
        }),
      ).toThrow(/clarityThreshold must be 0-100/);

      expect(() =>
        Interview.create({
          contextSchema: SimpleSchema,
          options: { clarityThreshold: -10 },
        }),
      ).toThrow(/clarityThreshold must be 0-100/);
    });
  });

  // ===========================================================================
  // CUSTOM AGENT OVERRIDES (4 tests)
  // ===========================================================================

  describe("Custom Agent Overrides", () => {
    it("custom evaluator override works", async () => {
      const customEvaluatorSpy = vi.fn().mockReturnValue(
        AgentUnit.of<ClarityScore>({
          overall: 100, // Immediately satisfied
          byField: { name: 100, email: 100 },
          missingCritical: [],
        }),
      );

      const unit = AgentUnit.of("input")
        .interview({
          contextSchema: SimpleSchema,
          evaluator: customEvaluatorSpy,
          extractor: mockExtractor({ name: "Test", email: "test@test.com" }),
        })
        .conduct({
          onQuestion: async (q) => ({
            questionId: q.id,
            text: "answer",
            timestamp: Date.now(),
          }),
        });

      await unit.run(ctx, { trustMode: "legacy" });

      // Evaluator should be called with the correct state structure
      expect(customEvaluatorSpy).toHaveBeenCalled();
      const callArg = customEvaluatorSpy.mock.calls[0][0];
      expect(callArg).toHaveProperty("answers");
      expect(callArg).toHaveProperty("currentContext");
      expect(callArg).toHaveProperty("round");
      expect(callArg).toHaveProperty("initialInput", "input");
    });

    it("custom questioner override works", async () => {
      const customQuestionerSpy = vi.fn().mockReturnValue(
        AgentUnit.of<Question | null>(null), // No questions
      );

      const unit = AgentUnit.of("input")
        .interview({
          contextSchema: SimpleSchema,
          questioner: customQuestionerSpy,
          evaluator: mockEvaluator(50), // Below threshold
          extractor: mockExtractor({ name: "Test", email: "test@test.com" }),
        })
        .conduct({
          onQuestion: async (q) => ({
            questionId: q.id,
            text: "answer",
            timestamp: Date.now(),
          }),
        });

      await unit.run(ctx, { trustMode: "legacy" });

      // Questioner should be called with state and clarity
      expect(customQuestionerSpy).toHaveBeenCalled();
      const [state, clarity] = customQuestionerSpy.mock.calls[0];
      expect(state).toHaveProperty("answers");
      expect(clarity).toHaveProperty("overall");
    });

    it("custom extractor override works", async () => {
      const customExtractorSpy = vi
        .fn()
        .mockReturnValue(
          AgentUnit.of({ name: "Custom", email: "custom@test.com" }),
        );

      const unit = AgentUnit.of("input")
        .interview({
          contextSchema: SimpleSchema,
          evaluator: mockEvaluator(100), // Immediately satisfied
          extractor: customExtractorSpy,
        })
        .conduct({
          onQuestion: async (q) => ({
            questionId: q.id,
            text: "answer",
            timestamp: Date.now(),
          }),
        });

      const result = await unit.run(ctx, { trustMode: "legacy" });

      expect(customExtractorSpy).toHaveBeenCalled();
      expect(result.context).toEqual({
        name: "Custom",
        email: "custom@test.com",
      });
    });

    it("partial overrides: only evaluator custom", async () => {
      const customEvaluator = mockEvaluator(100);

      const interview = Interview.create({
        contextSchema: ComplexSchema,
        evaluator: customEvaluator,
        // questioner and extractor should be auto-generated
      });

      expect(interview.evaluator).toBe(customEvaluator);
      expect(interview.questioner).toBeDefined();
      expect(interview.extractor).toBeDefined();
    });
  });

  // ===========================================================================
  // TYPE SAFETY (4 tests)
  // ===========================================================================

  describe("Type Safety", () => {
    it("type inference from schema", async () => {
      const unit = AgentUnit.of("input").interview({
        contextSchema: SimpleSchema,
      });

      const pending = await unit.run(ctx, { trustMode: "legacy" });

      // Verify the pending structure has the correct interview type
      expect(pending.__interviewPending).toBe(true);
      expect(pending.interview.contextSchema).toBe(SimpleSchema);
    });

    it("generic type propagation", async () => {
      // This test verifies that the generic type parameter is respected
      const StringSchema = z.object({
        value: z.string(),
      });

      const unit = AgentUnit.of("input")
        .interview({
          contextSchema: StringSchema,
          evaluator: mockEvaluator(100),
          extractor: mockExtractor({ value: "typed-value" }),
        })
        .conduct({
          onQuestion: async (q) => ({
            questionId: q.id,
            text: "answer",
            timestamp: Date.now(),
          }),
        });

      const result = await unit.run(ctx, { trustMode: "legacy" });

      // Type inference should work
      expect(result.context.value).toBe("typed-value");
    });

    it("config validation: invalid maxQuestions", () => {
      expect(() =>
        Interview.create({
          contextSchema: SimpleSchema,
          options: { maxQuestions: 0 },
        }),
      ).toThrow(/maxQuestions must be >= 1/);

      expect(() =>
        Interview.create({
          contextSchema: SimpleSchema,
          options: { maxQuestions: -5 },
        }),
      ).toThrow(/maxQuestions must be >= 1/);
    });

    it("Interview.create() factory works", () => {
      const interview = Interview.create({
        contextSchema: ComplexSchema,
        options: {
          clarityThreshold: 80,
          maxQuestions: 15,
        },
      });

      expect(interview).toBeInstanceOf(Interview);
      expect(interview.contextSchema).toBe(ComplexSchema);
      expect(interview.options.clarityThreshold).toBe(80);
      expect(interview.options.maxQuestions).toBe(15);
    });
  });
});
