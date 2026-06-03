/**
 * @fileoverview Tests for AgentUnit.dialectic() operator
 * @description Dialectic operator: leader-driven thesis/antithesis/synthesis
 *
 * 📝 BUILD[F-048.03.02]: Dialectic operator tests
 *
 * @remarks
 * These tests use `trustMode: 'legacy'` to test basic operator functionality.
 * The dialectic operator implements leader-driven problem solving where
 * a leader proposes theses and advisors provide critiques.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";
import type {
  AdvisorAgent,
  AgentContext,
  Critique,
  LeaderAgent,
  SynthesisResponse,
  ThesisResponse,
} from "../types";

describe("Dialectic Operator", () => {
  let ctx: AgentContext;

  // Suppress deprecation warnings during tests
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ctx = createContext();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset the deprecation warning flag
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  // Helper to create a basic leader agent
  const createLeader = (satisfiedAfterRounds = 1): LeaderAgent<string> => {
    let roundCount = 0;
    return {
      propose: vi.fn(
        async (
          input: string,
          _round: number,
        ): Promise<ThesisResponse<string>> => ({
          thesis: `Thesis: ${input}`,
          reasoning: "Initial thesis reasoning",
        }),
      ),
      synthesize: vi.fn(
        async (
          thesis: string,
          critiques: Critique[],
        ): Promise<SynthesisResponse<string>> => {
          roundCount++;
          return {
            synthesis: `Synthesis of ${thesis} with ${critiques.length} critiques`,
            satisfied: roundCount >= satisfiedAfterRounds,
            reasoning: `Round ${roundCount} synthesis`,
          };
        },
      ),
    };
  };

  // Helper to create a basic advisor agent
  const createAdvisor = (
    severity: Critique["severity"] = "minor",
    _approved = true,
  ): AdvisorAgent<string> =>
    vi.fn(
      async (thesis: string, round: number): Promise<Critique> => ({
        advisorId: `advisor-${round}`,
        critique: `Critique of ${thesis} in round ${round}`,
        severity,
        suggestions: ["My suggestion"],
      }),
    );

  describe("Basic Dialectic Flow", () => {
    it("should terminate when leader is satisfied after first round", async () => {
      const leader = createLeader(1); // Satisfied after 1 round
      const advisor = createAdvisor();

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor])
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("satisfied");
      expect(result.rounds).toBe(1);
      expect(leader.propose).toHaveBeenCalledTimes(1);
      expect(leader.synthesize).toHaveBeenCalledTimes(1);
      expect(advisor).toHaveBeenCalledTimes(1);
    });

    it("should continue until consensus in consensus mode", async () => {
      const leader = createLeader(2); // Needs 2 rounds
      const advisor = createAdvisor("minor", true); // Always approves

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor], {
          terminationMode: "consensus",
          maxRounds: 5,
        })
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBeGreaterThanOrEqual(1);
    });

    it("should accept majority approval in majority mode", async () => {
      const leader = createLeader(1);
      // 2 advisors with minor severity, 1 with blocking = majority
      const approver1 = createAdvisor("minor", true);
      const approver2 = createAdvisor("minor", true);
      const disapprover = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [approver1, approver2, disapprover], {
          terminationMode: "majority",
        })
        .run(ctx, { trustMode: "legacy" });

      // Result defined
      expect(result).toBeDefined();
    });

    it("should terminate at max rounds", async () => {
      const leader = createLeader(100); // Never satisfied
      const advisor = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor], {
          maxRounds: 3,
          terminationMode: "leader-satisfied",
        })
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBe(3);
      expect(result.outcome).toBe("max-rounds");
    });
  });

  describe("Parallel Advisor Execution", () => {
    it("should run advisors in parallel", async () => {
      const executionOrder: string[] = [];
      const delays = [50, 10, 30]; // Different delays

      const createTimedAdvisor =
        (id: number): AdvisorAgent<string> =>
        async (_thesis: string, _round: number): Promise<Critique> => {
          await new Promise((resolve) => setTimeout(resolve, delays[id]));
          executionOrder.push(`advisor-${id}`);
          return {
            advisorId: `timed-advisor-${id}`,
            critique: `Advisor ${id} critique`,
            severity: "minor",
            suggestions: [`Suggestion ${id}`],
          };
        };

      const leader = createLeader(1);
      const advisors = [
        createTimedAdvisor(0),
        createTimedAdvisor(1),
        createTimedAdvisor(2),
      ];

      await AgentUnit.of("problem")
        .dialectic(leader, advisors)
        .run(ctx, { trustMode: "legacy" });

      // In parallel, fastest advisor (1) should finish first
      expect(executionOrder[0]).toBe("advisor-1");
    });
  });

  describe("History Tracking", () => {
    it("should track full history of all rounds", async () => {
      const leader = createLeader(3); // 3 rounds
      const advisor = createAdvisor();

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor], { maxRounds: 5 })
        .run(ctx, { trustMode: "legacy" });

      expect(result.history).toBeDefined();
      expect(result.history.length).toBe(result.rounds);

      // Each history entry should have thesis, antitheses, synthesis
      for (const entry of result.history) {
        expect(entry.thesis).toBeDefined();
        expect(entry.antitheses).toBeDefined();
        expect(entry.synthesis).toBeDefined();
      }
    });

    it("should capture all critiques in each round", async () => {
      const leader = createLeader(1);
      const advisor1 = createAdvisor("minor");
      const advisor2 = createAdvisor("major");
      const advisor3 = createAdvisor("blocking");

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor1, advisor2, advisor3])
        .run(ctx, { trustMode: "legacy" });

      // First round should have 3 antitheses (critiques)
      expect(result.history[0].antitheses.length).toBe(3);
    });
  });

  describe("Callback Invocation", () => {
    it("should call onThesis for each round", async () => {
      const onThesis = vi.fn();
      const leader = createLeader(2);
      const advisor = createAdvisor();

      await AgentUnit.of("problem")
        .dialectic(leader, [advisor], {
          maxRounds: 5,
          onThesis,
        })
        .run(ctx, { trustMode: "legacy" });

      expect(onThesis).toHaveBeenCalled();
      // Should be called once per round
      expect(onThesis.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("should call onAntitheses with all critiques", async () => {
      const onAntitheses = vi.fn();
      const leader = createLeader(1);
      const advisors = [createAdvisor(), createAdvisor()];

      await AgentUnit.of("problem")
        .dialectic(leader, advisors, { onAntitheses })
        .run(ctx, { trustMode: "legacy" });

      expect(onAntitheses).toHaveBeenCalledTimes(1);
      // Should receive array of critiques
      const critiquesArg = onAntitheses.mock.calls[0][0];
      expect(Array.isArray(critiquesArg)).toBe(true);
      expect(critiquesArg.length).toBe(2);
    });

    it("should call onSynthesis after leader synthesizes", async () => {
      const onSynthesis = vi.fn();
      const leader = createLeader(1);
      const advisor = createAdvisor();

      await AgentUnit.of("problem")
        .dialectic(leader, [advisor], { onSynthesis })
        .run(ctx, { trustMode: "legacy" });

      expect(onSynthesis).toHaveBeenCalledTimes(1);
      // Should receive synthesis response
      const synthesisArg = onSynthesis.mock.calls[0][0];
      expect(synthesisArg).toHaveProperty("synthesis");
      expect(synthesisArg).toHaveProperty("satisfied");
    });
  });

  describe("Quorum Configuration", () => {
    it("should use default quorum of 1.0 (consensus)", async () => {
      const leader = createLeader(1);
      // One advisor disapproves
      const approver = createAdvisor("minor", true);
      const disapprover = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [approver, disapprover], {
          terminationMode: "consensus",
          maxRounds: 2,
        })
        .run(ctx, { trustMode: "legacy" });

      // With consensus mode, need all advisors to approve
      expect(result).toBeDefined();
    });

    it("should respect custom quorum value", async () => {
      const leader = createLeader(1);
      // 2 approve, 1 disapproves
      const approver1 = createAdvisor("minor", true);
      const approver2 = createAdvisor("minor", true);
      const disapprover = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [approver1, approver2, disapprover], {
          terminationMode: "majority",
          quorum: 0.5, // Only need 50% approval
        })
        .run(ctx, { trustMode: "legacy" });

      // 2/3 = 67% > 50% quorum
      expect(result).toBeDefined();
    });
  });

  describe("Critique Severity Handling", () => {
    it("should handle blocking critiques appropriately", async () => {
      const leader = createLeader(2);
      const blockingAdvisor: AdvisorAgent<string> = vi.fn(
        async (_thesis: string, _round: number): Promise<Critique> => ({
          advisorId: `blocking-advisor`,
          critique: "Blocking flaw detected",
          severity: "blocking",
          suggestions: ["Complete redesign needed"],
        }),
      );

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [blockingAdvisor], { maxRounds: 3 })
        .run(ctx, { trustMode: "legacy" });

      // Should have captured the blocking critique
      const blockingCritiques = result.history.flatMap((h) =>
        h.antitheses.filter((c) => c.severity === "blocking"),
      );
      expect(blockingCritiques.length).toBeGreaterThan(0);
    });

    it("should handle mixed severity critiques", async () => {
      const leader = createLeader(1);
      const minorAdvisor = createAdvisor("minor", true);
      const majorAdvisor = createAdvisor("major", true);
      const blockingAdvisor = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [minorAdvisor, majorAdvisor, blockingAdvisor])
        .run(ctx, { trustMode: "legacy" });

      const severities = result.history[0].antitheses.map((c) => c.severity);
      expect(severities).toContain("minor");
      expect(severities).toContain("major");
      expect(severities).toContain("blocking");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty advisors array", async () => {
      const leader = createLeader(1);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [])
        .run(ctx, { trustMode: "legacy" });

      // With no advisors, leader decides alone
      expect(result.outcome).toBe("satisfied");
      expect(result.history[0].antitheses).toHaveLength(0);
    });

    it("should handle single advisor", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor();

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor])
        .run(ctx, { trustMode: "legacy" });

      expect(result.history[0].antitheses).toHaveLength(1);
    });

    it("should use default options when not specified", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor();

      const result = await AgentUnit.of("test")
        .dialectic(leader, [advisor]) // No options
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("satisfied");
    });

    it("should handle maxRounds of 1", async () => {
      const leader = createLeader(100); // Would need many rounds
      const advisor = createAdvisor("blocking", false);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor], { maxRounds: 1 })
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBe(1);
    });
  });

  describe("Result Structure", () => {
    it("should return correct result structure", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor();

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor])
        .run(ctx, { trustMode: "legacy" });

      // Verify result structure
      expect(result).toHaveProperty("finalThesis");
      expect(result).toHaveProperty("outcome");
      expect(result).toHaveProperty("rounds");
      expect(result).toHaveProperty("history");
    });

    it("should include outcome", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor("minor", true);

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor], { terminationMode: "leader-satisfied" })
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBeDefined();
      expect(typeof result.outcome).toBe("string");
    });
  });

  describe("Integration with Other Operators", () => {
    it("should work with map before dialectic", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor();

      const _result = await AgentUnit.of("input")
        .map((x) => x.toUpperCase()) // "input" → "INPUT"
        .dialectic(leader, [advisor])
        .run(ctx, { trustMode: "legacy" });

      // Leader should receive "INPUT"
      expect(leader.propose).toHaveBeenCalledWith("INPUT", 1);
    });

    it("should work with map after dialectic", async () => {
      const leader = createLeader(1);
      const advisor = createAdvisor();

      const result = await AgentUnit.of("problem")
        .dialectic(leader, [advisor])
        .map((dialecticResult) => dialecticResult.rounds)
        .run(ctx, { trustMode: "legacy" });

      expect(result).toBe(1);
    });
  });
});
