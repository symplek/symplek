/**
 * @fileoverview AgentUnit Integration Tests
 * @description Tests for interview operators integration with AgentUnit infrastructure
 * @module weft-core/interview/__tests__/agentunit-integration.test
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[Weft-interview-operator]: Story 03-06 - Integration Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentUnit, createContext } from "../../index";
import type { AgentContext } from "../../types";
import type {
  Answer,
  ClarityScore,
  InterviewResult,
  InterviewState,
  Question,
} from "../types";

// =============================================================================
// TEST SCHEMAS
// =============================================================================

const ProjectSchema = z.object({
  name: z.string(),
  budget: z.number().optional(),
  deadline: z.string().optional(),
});

type ProjectContext = z.infer<typeof ProjectSchema>;

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create mock evaluator.
 */
function mockEvaluator(score: number) {
  return (_state: InterviewState) =>
    AgentUnit.of<ClarityScore>({
      overall: score,
      byField: { name: score, budget: score, deadline: score },
      missingCritical: score < 80 ? ["name"] : [],
    });
}

/**
 * Create mock questioner that returns null (no questions).
 */
function mockQuestionerDone() {
  return (_state: InterviewState, _clarity: ClarityScore) =>
    AgentUnit.of<Question | null>(null);
}

/**
 * Create mock extractor.
 */
function mockExtractor(context: ProjectContext) {
  return (_state: InterviewState) => AgentUnit.of<ProjectContext>(context);
}

/**
 * Create test handlers.
 */
function createTestHandlers() {
  return {
    onQuestion: async (q: Question): Promise<Answer> => ({
      questionId: q.id,
      text: "test answer",
      timestamp: Date.now(),
    }),
  };
}

describe("AgentUnit Integration Tests", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // AGENTUNIT OPERATOR INTEGRATION (3 tests)
  // ===========================================================================

  describe("AgentUnit Operator Integration", () => {
    it("interview works with existing AgentUnit operators", async () => {
      const result = await AgentUnit.of("Build task app")
        .map((s) => s.toUpperCase())
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Task App" }),
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Task App");
    });

    it("end-to-end type inference works", async () => {
      // Full typed chain from input to output
      const result = await AgentUnit.of("project input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({
            name: "Typed Project",
            budget: 50000,
            deadline: "2025-01-01",
          }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          projectName: r.context.name,
          hasBudget: r.context.budget !== undefined,
        }))
        .run(ctx, { trustMode: "legacy" });

      // Type inference should work through chain
      expect(result.projectName).toBe("Typed Project");
      expect(result.hasBudget).toBe(true);
    });

    it("error handling propagates through interview", async () => {
      const failingExtractor = () =>
        AgentUnit.fail<ProjectContext>(new Error("Could not extract context"));

      await expect(
        AgentUnit.of("input")
          .interview({
            contextSchema: ProjectSchema,
            evaluator: mockEvaluator(100),
            questioner: mockQuestionerDone(),
            extractor: failingExtractor,
          })
          .conduct(createTestHandlers())
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow("Could not extract context");
    });
  });

  // ===========================================================================
  // CONTEXT INTEGRATION (3 tests)
  // ===========================================================================

  describe("Context Integration", () => {
    it("interview operators use AgentContext correctly", async () => {
      let capturedCtx: AgentContext | null = null;

      const contextCapturingExtractor = (_state: InterviewState) => {
        return AgentUnit.from(async (context: AgentContext) => {
          capturedCtx = context;
          return { name: "Extracted" };
        });
      };

      await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: contextCapturingExtractor,
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "legacy" });

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx).toHaveProperty("timestamp");
    });

    it("context extensions preserved through interview", async () => {
      const customCtx = createContext({
        extensions: { customField: "customValue" },
      });

      let capturedExtensions: Record<string, unknown> | undefined;

      const extensionsCapturingExtractor = (_state: InterviewState) => {
        return AgentUnit.from(async (context: AgentContext) => {
          capturedExtensions = context.extensions;
          return { name: "Extracted" };
        });
      };

      await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: extensionsCapturingExtractor,
        })
        .conduct(createTestHandlers())
        .run(customCtx, { trustMode: "legacy" });

      expect(capturedExtensions).toBeDefined();
      expect(capturedExtensions?.customField).toBe("customValue");
    });

    it("timestamp consistent through interview execution", async () => {
      const timestamps: number[] = [];

      const timestampCapturingEvaluator = (_state: InterviewState) => {
        return AgentUnit.from(async (context: AgentContext) => {
          timestamps.push(context.timestamp);
          return {
            overall: 100,
            byField: {},
            missingCritical: [],
          } as ClarityScore;
        });
      };

      await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: timestampCapturingEvaluator,
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Project" }),
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "legacy" });

      expect(timestamps.length).toBeGreaterThan(0);
      // All timestamps should be the same (same context passed through)
      const allSame = timestamps.every((ts) => ts === timestamps[0]);
      expect(allSame).toBe(true);
    });
  });

  // ===========================================================================
  // TRUST MODE INTEGRATION (2 tests)
  // ===========================================================================

  describe("Trust Mode Integration", () => {
    it("trustMode: legacy works with interview", async () => {
      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Legacy Project" }),
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Legacy Project");
    });

    it("trustMode: zero-trust works with interview", async () => {
      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Zero-Trust Project" }),
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "zero-trust" });

      // In zero-trust mode, result is TrackedResult
      expect(result.value.context.name).toBe("Zero-Trust Project");
    });
  });

  // ===========================================================================
  // CONTRACT VALIDATION INTEGRATION (2 tests)
  // ===========================================================================

  describe("Contract Validation Integration", () => {
    it(".provides() validates interview result against schema", async () => {
      const ResultSchema = z.object({
        context: ProjectSchema,
        clarityScore: z.number(),
        questionsAsked: z.number(),
        converged: z.boolean(),
        answers: z.array(z.any()),
        assumptions: z.array(z.any()),
      });

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Validated Project" }),
        })
        .conduct(createTestHandlers())
        .provides(ResultSchema)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Validated Project");
      expect(typeof result.clarityScore).toBe("number");
    });

    it("source tracking propagation through interview", async () => {
      // Test that source tracking works through interview chain
      const result = await AgentUnit.of("user input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Tracked Project" }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          ...r,
          tracked: true,
        }))
        .run(ctx, { trustMode: "zero-trust" });

      // In zero-trust mode, result is TrackedResult
      expect(result.value.context.name).toBe("Tracked Project");
      expect(result.value.tracked).toBe(true);
    });
  });
});
