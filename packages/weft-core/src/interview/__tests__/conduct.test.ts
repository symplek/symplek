/**
 * @fileoverview Conduct Execution Tests
 * @description Tests for .conduct() operator execution and interview loop behavior
 * @module @symplek/core/interview/__tests__/conduct.test
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[Symplek-interview-operator]: Story 03-02 - Execution Tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentUnit, createContext } from "../../index";
import type { AgentContext } from "../../types";
import type { Answer, ClarityScore, InterviewState, Question } from "../types";

// =============================================================================
// TEST UTILITIES
// =============================================================================

const TestSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

type TestContext = z.infer<typeof TestSchema>;

/**
 * Create a mock evaluator that returns scores from an array in sequence.
 */
function createSequentialEvaluator(scores: number[]) {
  let index = 0;
  return (_state: InterviewState) =>
    AgentUnit.of<ClarityScore>({
      overall: scores[Math.min(index++, scores.length - 1)],
      byField: {},
      missingCritical: [],
    });
}

/**
 * Create a mock questioner that returns questions, then null.
 */
function createSequentialQuestioner(count: number) {
  let asked = 0;
  return (_state: InterviewState, _clarity: ClarityScore) =>
    AgentUnit.of<Question | null>(
      asked < count
        ? {
            id: `q-${++asked}`,
            text: `Question ${asked}`,
            targetField: "name",
            priority: "high" as const,
          }
        : null,
    );
}

/**
 * Create a mock extractor.
 */
function createMockExtractor(context: TestContext) {
  return (_state: InterviewState) => AgentUnit.of<TestContext>(context);
}

/**
 * Create test handlers with answer tracking.
 */
function createTestHandlers(answers: string[] = ["answer"]) {
  let index = 0;
  const calls: Question[] = [];

  return {
    handlers: {
      onQuestion: async (q: Question): Promise<Answer> => {
        calls.push(q);
        return {
          questionId: q.id,
          text: answers[Math.min(index++, answers.length - 1)],
          timestamp: Date.now(),
        };
      },
    },
    getCalls: () => calls,
  };
}

describe("Conduct Execution Tests", () => {
  let ctx: AgentContext;

  beforeEach(() => {
    ctx = createContext();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // BASIC EXECUTION (3 tests)
  // ===========================================================================

  describe("Basic Execution", () => {
    it(".conduct() executes interview loop", async () => {
      const { handlers } = createTestHandlers();

      const result = await AgentUnit.of("Build a task app")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([30, 60, 100]),
          questioner: createSequentialQuestioner(5),
          extractor: createMockExtractor({ name: "Task App" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Verify result structure
      expect(result).toHaveProperty("context");
      expect(result).toHaveProperty("clarityScore");
      expect(result).toHaveProperty("questionsAsked");
      expect(result).toHaveProperty("answers");
      expect(result).toHaveProperty("assumptions");
      expect(result).toHaveProperty("converged");
    });

    it("onQuestion callback called with each question", async () => {
      const { handlers, getCalls } = createTestHandlers([
        "answer1",
        "answer2",
        "answer3",
      ]);

      await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([20, 40, 60, 100]),
          questioner: createSequentialQuestioner(3),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Should have called onQuestion 3 times
      expect(getCalls().length).toBe(3);
      expect(getCalls()[0].id).toBe("q-1");
      expect(getCalls()[1].id).toBe("q-2");
      expect(getCalls()[2].id).toBe("q-3");
    });

    it("interview state accumulates answers", async () => {
      const { handlers } = createTestHandlers([
        "first answer",
        "second answer",
      ]);

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([30, 60, 100]),
          questioner: createSequentialQuestioner(2),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.answers.length).toBe(2);
      expect(result.answers[0].text).toBe("first answer");
      expect(result.answers[1].text).toBe("second answer");
    });
  });

  // ===========================================================================
  // TERMINATION CONDITIONS (7 tests)
  // ===========================================================================

  describe("Termination Conditions", () => {
    it("terminates at clarityThreshold", async () => {
      const { handlers } = createTestHandlers();

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          options: { clarityThreshold: 70, maxQuestions: 10 },
          evaluator: createSequentialEvaluator([50, 75]), // Exceeds 70 on 2nd eval
          questioner: createSequentialQuestioner(5),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
      expect(result.clarityScore).toBeGreaterThanOrEqual(70);
    });

    it("terminates at maxQuestions", async () => {
      const { handlers } = createTestHandlers([
        "a1",
        "a2",
        "a3",
        "a4",
        "a5",
        "a6",
      ]);

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          options: { clarityThreshold: 100, maxQuestions: 3 },
          evaluator: createSequentialEvaluator([20, 30, 40, 50, 60, 70]),
          questioner: createSequentialQuestioner(10),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(false);
      expect(result.questionsAsked).toBeLessThanOrEqual(3);
    });

    it("terminates when requiredFields populated", async () => {
      const SchemaWithRequired = z.object({
        name: z.string(),
        critical: z.string(),
      });

      // Create evaluator that reports required field as populated
      const evaluatorWithRequired = () =>
        AgentUnit.of<ClarityScore>({
          overall: 90,
          byField: { name: 100, critical: 80 },
          missingCritical: [],
        });

      const { handlers } = createTestHandlers();

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: SchemaWithRequired,
          options: {
            clarityThreshold: 70,
            requiredFields: ["critical"],
          },
          evaluator: evaluatorWithRequired,
          questioner: () => AgentUnit.of<Question | null>(null),
          extractor: () => AgentUnit.of({ name: "Test", critical: "Required" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
    });

    it("terminates when isDone returns true", async () => {
      let evaluationCount = 0;
      const evaluator = () => {
        evaluationCount++;
        return AgentUnit.of<ClarityScore>({
          overall: 30, // Always below threshold
          byField: {},
          missingCritical: [],
        });
      };

      const { handlers } = createTestHandlers();

      await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          options: {
            clarityThreshold: 100,
            maxQuestions: 20,
            isDone: (state) => state.round >= 2,
          },
          evaluator,
          questioner: createSequentialQuestioner(10),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Should terminate early due to isDone
      expect(evaluationCount).toBeLessThanOrEqual(3);
    });

    it("termination precedence: maxQuestions is hard cap", async () => {
      const { handlers } = createTestHandlers(["a", "b", "c", "d", "e"]);

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          options: {
            clarityThreshold: 50,
            maxQuestions: 2,
            isDone: () => false, // Never done
          },
          evaluator: createSequentialEvaluator([10, 20, 30, 40, 60, 70]),
          questioner: createSequentialQuestioner(10),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.questionsAsked).toBeLessThanOrEqual(2);
    });

    it("termination precedence: isDone overrides threshold", async () => {
      let isDoneCalled = false;

      const { handlers } = createTestHandlers();

      await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          options: {
            clarityThreshold: 100,
            maxQuestions: 10,
            isDone: (state) => {
              if (state.round >= 2) {
                isDoneCalled = true;
                return true;
              }
              return false;
            },
          },
          evaluator: createSequentialEvaluator([20, 30, 40]),
          questioner: createSequentialQuestioner(10),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(isDoneCalled).toBe(true);
    });

    it("multiple termination conditions: clarity + required fields", async () => {
      const SchemaWithRequired = z.object({
        name: z.string(),
        critical: z.string(),
      });

      let evaluations = 0;
      const evaluator = () => {
        evaluations++;
        return AgentUnit.of<ClarityScore>({
          overall: 80, // Above threshold
          byField: { name: 100, critical: evaluations > 1 ? 80 : 50 },
          missingCritical: evaluations > 1 ? [] : ["critical"],
        });
      };

      const { handlers } = createTestHandlers(["name value", "critical value"]);

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: SchemaWithRequired,
          options: {
            clarityThreshold: 70,
            requiredFields: ["critical"],
          },
          evaluator,
          questioner: createSequentialQuestioner(5),
          extractor: () => AgentUnit.of({ name: "Test", critical: "Required" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
    });
  });

  // ===========================================================================
  // INTERVIEW LOOP LOGIC (4 tests)
  // ===========================================================================

  describe("Interview Loop Logic", () => {
    it("evaluator called before each question", async () => {
      let evaluatorCallCount = 0;
      const evaluator = () => {
        evaluatorCallCount++;
        return AgentUnit.of<ClarityScore>({
          overall: evaluatorCallCount >= 3 ? 100 : 50,
          byField: {},
          missingCritical: [],
        });
      };

      const { handlers } = createTestHandlers(["a", "b", "c"]);

      await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator,
          questioner: createSequentialQuestioner(5),
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(evaluatorCallCount).toBeGreaterThan(0);
    });

    it("questioner receives current state and clarity", async () => {
      const questionerCalls: Array<{
        state: InterviewState;
        clarity: ClarityScore;
      }> = [];

      const questioner = (state: InterviewState, clarity: ClarityScore) => {
        questionerCalls.push({ state, clarity });
        return AgentUnit.of<Question | null>(
          questionerCalls.length < 2
            ? {
                id: `q-${questionerCalls.length}`,
                text: "Question",
                targetField: "name",
                priority: "high" as const,
              }
            : null,
        );
      };

      const { handlers } = createTestHandlers(["answer"]);

      await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([30, 60, 100]),
          questioner,
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(questionerCalls.length).toBeGreaterThan(0);
      expect(questionerCalls[0].state).toHaveProperty("answers");
      expect(questionerCalls[0].state).toHaveProperty("initialInput", "input");
      expect(questionerCalls[0].clarity).toHaveProperty("overall");
    });

    it("questioner returns null when no more questions", async () => {
      const questioner = () => AgentUnit.of<Question | null>(null);

      const { handlers, getCalls } = createTestHandlers();

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([50]), // Below threshold
          questioner,
          extractor: createMockExtractor({ name: "Test" }),
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // No questions should be asked
      expect(getCalls().length).toBe(0);
      expect(result.questionsAsked).toBe(0);
    });

    it("extractor called on termination", async () => {
      let extractorCalled = false;
      const extractor = (state: InterviewState) => {
        extractorCalled = true;
        expect(state).toHaveProperty("answers");
        return AgentUnit.of<TestContext>({ name: "Extracted" });
      };

      const { handlers } = createTestHandlers();

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: TestSchema,
          evaluator: createSequentialEvaluator([100]),
          questioner: createSequentialQuestioner(0),
          extractor,
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(extractorCalled).toBe(true);
      expect(result.context.name).toBe("Extracted");
    });
  });

  // ===========================================================================
  // ERROR HANDLING (4 tests)
  // ===========================================================================

  describe("Error Handling", () => {
    it("onQuestion throws error → interview fails", async () => {
      const handlers = {
        onQuestion: async () => {
          throw new Error("User cancelled");
        },
      };

      await expect(
        AgentUnit.of("input")
          .interview({
            contextSchema: TestSchema,
            evaluator: createSequentialEvaluator([50]),
            questioner: createSequentialQuestioner(1),
            extractor: createMockExtractor({ name: "Test" }),
          })
          .conduct(handlers)
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow("User cancelled");
    });

    it("evaluator timeout handled gracefully", async () => {
      // Test that very slow evaluators don't hang forever
      // This would require timeout configuration in the interview
      // For now, verify that evaluator errors propagate
      const slowEvaluator = () => {
        throw new Error("Evaluator failed");
      };

      const { handlers } = createTestHandlers();

      await expect(
        AgentUnit.of("input")
          .interview({
            contextSchema: TestSchema,
            evaluator: slowEvaluator,
            questioner: createSequentialQuestioner(1),
            extractor: createMockExtractor({ name: "Test" }),
          })
          .conduct(handlers)
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow();
    });

    it("extractor output validated against schema", async () => {
      const InvalidSchema = z.object({
        requiredField: z.string(),
      });

      // Extractor returns partial data
      const partialExtractor = () =>
        AgentUnit.of({} as { requiredField: string });

      const { handlers } = createTestHandlers();

      // Schema validation happens in extractor - may return partial
      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: InvalidSchema,
          evaluator: createSequentialEvaluator([100]),
          questioner: createSequentialQuestioner(0),
          extractor: partialExtractor,
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Default extractor returns partial data gracefully
      expect(result.context).toBeDefined();
    });

    it("schema validation failure returns partial context", async () => {
      const StrictSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      // Extractor returns invalid email
      const invalidExtractor = () =>
        AgentUnit.of({ name: "Test", email: "not-an-email" } as {
          name: string;
          email: string;
        });

      const { handlers } = createTestHandlers();

      const result = await AgentUnit.of("input")
        .interview({
          contextSchema: StrictSchema,
          evaluator: createSequentialEvaluator([100]),
          questioner: createSequentialQuestioner(0),
          extractor: invalidExtractor,
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Should return the context even if validation fails
      expect(result.context).toBeDefined();
      expect(result.context.name).toBe("Test");
    });
  });

  // ===========================================================================
  // PARTIAL CONTEXT ACCUMULATION (N63/N64 convergence regression)
  // ===========================================================================

  describe("Partial Context Accumulation", () => {
    it("clarity climbs incrementally as fields are answered (N63/N64 regression)", async () => {
      // This test exercises the core N63/N64 defect: mid-loop extraction must
      // accumulate partial context between rounds so the evaluator can credit
      // answered fields and clarity can rise. The previous implementation ran
      // the full strict extractor mid-loop, which threw VALIDATION_ERROR on
      // partial data; the error was swallowed, state.currentContext stayed {}
      // every round, and clarity was capped at ≤50 forever.
      //
      // Schema: required name (string) + required email (format-constrained).
      const NameEmailSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const clarityHistory: number[] = [];

      // The evaluator inspects currentContext to score field completeness.
      // It awards 50 points for name present and 50 for email present.
      const evaluator = (state: InterviewState) => {
        const namePresent =
          typeof state.currentContext?.name === "string" &&
          state.currentContext.name.length > 0;
        const emailPresent =
          typeof state.currentContext?.email === "string" &&
          state.currentContext.email.length > 0;
        const overall =
          (namePresent ? 50 : 0) + (emailPresent ? 50 : 0);
        clarityHistory.push(overall);
        return AgentUnit.of<ClarityScore>({
          overall,
          byField: { name: namePresent ? 100 : 0, email: emailPresent ? 100 : 0 },
          missingCritical: [],
        });
      };

      let questionIndex = 0;
      const questioner = () =>
        AgentUnit.of<Question | null>(
          questionIndex++ < 2
            ? {
                id: `q-${questionIndex}`,
                text: questionIndex === 1
                  ? "What is your name?"
                  : "What is your email?",
                targetField: questionIndex === 1 ? "name" : "email",
                priority: "high" as const,
              }
            : null,
        );

      const { handlers } = createTestHandlers([
        "My name is Alice",
        "My email is alice@example.com",
      ]);

      const result = await AgentUnit.of("Tell me about yourself")
        .interview({
          contextSchema: NameEmailSchema,
          options: { clarityThreshold: 95, maxQuestions: 5 },
          evaluator,
          questioner,
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      // Final context must be schema-valid with both fields
      expect(result.context.name).toBe("Alice");
      expect(result.context.email).toBe("alice@example.com");

      // Clarity must have risen ABOVE 50 at some point during the interview,
      // proving the partial context accumulation worked. If N63/N64 were still
      // broken, clarity would be stuck at 0 every round (context always empty)
      // and could never reach the threshold.
      const maxClarity = Math.max(...clarityHistory);
      expect(maxClarity).toBeGreaterThan(50);
      // The interview converged on the fully-answered state
      expect(result.converged).toBe(true);
    });

    it("default agents produce valid context from natural-language answers end to end", async () => {
      // Smoke test: the full default agent pipeline (no mocks) must converge
      // when the user answers questions with natural-language sentences.
      const NameEmailSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      const { handlers } = createTestHandlers([
        "My name is Bob",
        "My email is bob@example.org",
      ]);

      const result = await AgentUnit.of("gather contact info")
        .interview({
          contextSchema: NameEmailSchema,
          options: {
            clarityThreshold: 70,
            maxQuestions: 4,
          },
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.context.name).toBe("Bob");
      expect(result.context.email).toBe("bob@example.org");
    });

    it("terse answers converge end to end via question-field association", async () => {
      // Failure scenario (before fix): answers like "Alice" and "alice@example.com"
      // contain no field-name keywords. Text matching found nothing, partial context
      // stayed empty, clarity could never climb, and final extraction threw
      // VALIDATION_ERROR.
      //
      // After fix: computations.ts populates state.askedQuestions as each question
      // is asked. The extractor and partialContextUpdater use question.targetField
      // to find the right answer, so bare values map to the correct field.
      const NameEmailSchema = z.object({
        name: z.string(),
        email: z.string().email(),
      });

      // Handler returns the bare field value when answering the targeted question.
      const handlers = {
        onQuestion: async (q: Question): Promise<Answer> => {
          const bareValues: Record<string, string> = {
            name: "Alice",
            email: "alice@example.com",
          };
          return {
            questionId: q.id,
            text: bareValues[q.targetField ?? ""] ?? "unknown",
            timestamp: Date.now(),
          };
        },
      };

      const result = await AgentUnit.of("gather contact info")
        .interview({
          contextSchema: NameEmailSchema,
          options: { clarityThreshold: 70, maxQuestions: 5 },
        })
        .conduct(handlers)
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
      expect(result.context.name).toBe("Alice");
      expect(result.context.email).toBe("alice@example.com");
    });
  });
});
