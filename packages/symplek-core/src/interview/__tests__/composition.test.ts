/**
 * @fileoverview Composition Tests
 * @description Tests for algebraic composition with other AgentUnit operators
 * @module @symplek/core/interview/__tests__/composition.test
 * @since 1.0.0-beta.3
 *
 * 📝 BUILD[Symplek-interview-operator]: Story 03-04 - Composition Tests
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
});

type ProjectContext = z.infer<typeof ProjectSchema>;

// =============================================================================
// TEST UTILITIES
// =============================================================================

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
 * Create a mock questioner that always returns null.
 */
function mockQuestionerDone() {
  return (_state: InterviewState, _clarity: ClarityScore) =>
    AgentUnit.of<Question | null>(null);
}

/**
 * Create a mock extractor.
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
      text: "answer",
      timestamp: Date.now(),
    }),
  };
}

describe("Composition Tests", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // BASIC COMPOSITION (5 tests)
  // ===========================================================================

  describe("Basic Composition", () => {
    it("interview → conduct → map", async () => {
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "My Project", budget: 50000 }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          ...r,
          processed: true,
        }))
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("My Project");
      expect(result.processed).toBe(true);
    });

    it("interview → conduct → flatMap", async () => {
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "My Project" }),
        })
        .conduct(createTestHandlers())
        .flatMap((r: InterviewResult<ProjectContext>) =>
          AgentUnit.of({
            projectName: r.context.name,
            questionsTotal: r.questionsAsked,
          }),
        )
        .run(ctx, { trustMode: "legacy" });

      expect(result.projectName).toBe("My Project");
      expect(result.questionsTotal).toBe(0);
    });

    it("interview → conduct → provides (contract validation)", async () => {
      const OutputSchema = z.object({
        context: ProjectSchema,
        clarityScore: z.number(),
        questionsAsked: z.number(),
        answers: z.array(
          z.object({
            questionId: z.string(),
            text: z.string(),
            timestamp: z.number(),
          }),
        ),
        assumptions: z.array(z.any()),
        converged: z.boolean(),
      });

      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Project" }),
        })
        .conduct(createTestHandlers())
        .provides(OutputSchema)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Project");
      expect(result.converged).toBe(true);
    });

    it("interview → conduct → timeout", async () => {
      // Test with sufficient timeout
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Project" }),
        })
        .conduct(createTestHandlers())
        .timeout(5000)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Project");
    });

    it("interview → conduct → retry", async () => {
      let attempts = 0;

      // Extractor that fails once, then succeeds
      const flakyExtractor = (_state: InterviewState) => {
        attempts++;
        if (attempts < 2) {
          return AgentUnit.fail<ProjectContext>(new Error("Transient error"));
        }
        return AgentUnit.of<ProjectContext>({ name: "Success" });
      };

      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: flakyExtractor,
        })
        .conduct(createTestHandlers())
        .retry(3)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Success");
      expect(attempts).toBe(2);
    });
  });

  // ===========================================================================
  // FALLBACK COMPOSITION (2 tests)
  // ===========================================================================

  describe("Fallback Composition", () => {
    it("interview → conduct → fallback", async () => {
      const failingExtractor = () =>
        AgentUnit.fail<ProjectContext>(new Error("Extraction failed"));

      const fallbackUnit = AgentUnit.of("Fallback input")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Fallback Project" }),
        })
        .conduct(createTestHandlers());

      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: failingExtractor,
        })
        .conduct(createTestHandlers())
        .fallback(fallbackUnit)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Fallback Project");
    });

    it("complex composition: interview → conduct → map → fallback", async () => {
      const fallbackUnit = AgentUnit.of("Fallback")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Fallback" }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          ...r,
          enhanced: false,
        }));

      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Main Project" }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          ...r,
          enhanced: true,
        }))
        .fallback(fallbackUnit)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Main Project");
      expect(result.enhanced).toBe(true);
    });
  });

  // ===========================================================================
  // FULL ALGEBRAIC COMPOSITION (2 tests)
  // ===========================================================================

  describe("Full Algebraic Composition", () => {
    it("full composition: of → interview → conduct → map → provides → timeout → retry", async () => {
      const ValidationSchema = z.object({
        projectName: z.string(),
        completed: z.boolean(),
      });

      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Composed Project" }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          projectName: r.context.name,
          completed: r.converged,
        }))
        .provides(ValidationSchema)
        .timeout(5000)
        .retry(2)
        .run(ctx, { trustMode: "legacy" });

      expect(result.projectName).toBe("Composed Project");
      expect(result.completed).toBe(true);
    });

    it("type inference preserved through chain", async () => {
      // This test verifies TypeScript type inference works
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Typed Project", budget: 100 }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => r.context)
        .run(ctx, { trustMode: "legacy" });

      // TypeScript should infer this correctly
      const name: string = result.name;
      const budget: number | undefined = result.budget;

      expect(name).toBe("Typed Project");
      expect(budget).toBe(100);
    });
  });

  // ===========================================================================
  // SOURCE TRACKING INTEGRATION (3 tests)
  // ===========================================================================

  describe("Source Tracking Integration", () => {
    it("source tracking via .tracked() works", async () => {
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Tracked Project" }),
        })
        .conduct(createTestHandlers())
        .tracked({ source: "user", confidence: 0.9 })
        .run(ctx, { trustMode: "legacy" });

      // Result should have source tracking metadata
      expect(result.value.context.name).toBe("Tracked Project");
      expect(result.source).toBe("user");
    });

    it("zero-trust mode produces TrackedResult", async () => {
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Project" }),
        })
        .conduct(createTestHandlers())
        .run(ctx, { trustMode: "zero-trust" });

      // Zero-trust wraps in TrackedResult
      expect(result.value.context.name).toBe("Project");
      expect(result).toHaveProperty("source");
      expect(result).toHaveProperty("confidence");
    });

    it("interview result can be marked as verified", async () => {
      const result = await AgentUnit.of("Build project")
        .interview({
          contextSchema: ProjectSchema,
          evaluator: mockEvaluator(100),
          questioner: mockQuestionerDone(),
          extractor: mockExtractor({ name: "Verified Project" }),
        })
        .conduct(createTestHandlers())
        .map((r: InterviewResult<ProjectContext>) => ({
          ...r,
          verified: true,
        }))
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Verified Project");
      expect(result.verified).toBe(true);
    });
  });
});
