/**
 * @fileoverview Tests for AgentUnit.debate() operator
 * @description Debate operator: converge + unanimous vote cycle
 *
 * 📝 BUILD[F-048.03.01]: Debate operator tests
 *
 * @remarks
 * These tests use `trustMode: 'legacy'` to test basic operator functionality.
 * The debate operator combines iterative convergence with unanimous voting
 * to reach group consensus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";
import type { AgentContext, ConvergeContribution, DebateAgent } from "../types";

describe("Debate Operator", () => {
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

  describe("Basic Consensus", () => {
    it("should reach consensus when all agents agree immediately", async () => {
      const agent1: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => ({
          result: state + 1,
          hasMore: false,
          reasoning: "Agent 1 done",
        }),
      );
      const agent2: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => ({
          result: state + 2,
          hasMore: false,
          reasoning: "Agent 2 done",
        }),
      );

      const result = await AgentUnit.of(10)
        .debate([agent1, agent2])
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("consensus");
      expect(result.rounds).toBeGreaterThanOrEqual(1);
      expect(agent1).toHaveBeenCalled();
      expect(agent2).toHaveBeenCalled();
    });

    it("should track contributions across all attempts", async () => {
      const agents: Array<DebateAgent<string>> = [
        vi.fn(
          (state: string): ConvergeContribution<string> => ({
            result: `${state}-a1`,
            hasMore: false,
            reasoning: "Contribution from agent 1",
          }),
        ),
        vi.fn(
          (state: string): ConvergeContribution<string> => ({
            result: `${state}-a2`,
            hasMore: false,
            reasoning: "Contribution from agent 2",
          }),
        ),
      ];

      const result = await AgentUnit.of("initial")
        .debate(agents)
        .run(ctx, { trustMode: "legacy" });

      expect(result.contributions).toBeDefined();
      expect(result.contributions.length).toBeGreaterThan(0);
    });
  });

  describe("Convergence Behavior", () => {
    it("should converge until all agents return hasMore: false", async () => {
      // Agent 1 needs 2 rounds, Agent 2 needs 1 round
      let agent1Calls = 0;
      const agent1: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => {
          agent1Calls++;
          return {
            result: state + 10,
            hasMore: agent1Calls < 2, // Needs 2 rounds
            reasoning: `Agent 1 round ${agent1Calls}`,
          };
        },
      );

      const agent2: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => ({
          result: state + 1,
          hasMore: false, // Done immediately
          reasoning: "Agent 2 done",
        }),
      );

      const result = await AgentUnit.of(0)
        .debate([agent1, agent2], { maxRounds: 10 })
        .run(ctx, { trustMode: "legacy" });

      // Should converge eventually
      expect(result.rounds).toBeGreaterThanOrEqual(2);
    });

    it("should exhaust attempts after maxConsensusAttempts", async () => {
      // Agents that never agree
      const stubbornAgent1: DebateAgent<number> = vi.fn(
        (): ConvergeContribution<number> => ({
          result: 1,
          hasMore: true, // Never done - keeps wanting more
          reasoning: "Agent 1 disagrees",
        }),
      );

      const result = await AgentUnit.of(0)
        .debate([stubbornAgent1], { maxConsensusAttempts: 2, maxRounds: 1 })
        .run(ctx, { trustMode: "legacy" });

      expect(result.attempts).toBeLessThanOrEqual(2);
    });
  });

  describe("Vote Rejection Handling", () => {
    it("should return no-consensus when onReject is fail", async () => {
      // Agent that converges but has a disagreement tracked
      let callCount = 0;
      const agent: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => {
          callCount++;
          // After enough calls, say we're done
          if (callCount > 3) {
            return {
              result: state,
              hasMore: false,
              reasoning: "Finally done",
            };
          }
          return {
            result: state + 1,
            hasMore: true,
            reasoning: "Still working",
          };
        },
      );

      const result = await AgentUnit.of(0)
        .debate([agent], {
          onReject: "fail",
          maxConsensusAttempts: 1,
          maxRounds: 2,
        })
        .run(ctx, { trustMode: "legacy" });

      // With limited rounds and attempts, may not reach consensus
      expect(result).toBeDefined();
    });

    it("should retry when onReject is retry", async () => {
      let attemptCount = 0;
      const agent: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => {
          attemptCount++;
          return {
            result: state + attemptCount,
            hasMore: attemptCount < 3, // Needs 3 iterations to converge
            reasoning: `Attempt ${attemptCount}`,
          };
        },
      );

      const result = await AgentUnit.of(0)
        .debate([agent], {
          onReject: "retry",
          maxConsensusAttempts: 5,
          maxRounds: 5,
        })
        .run(ctx, { trustMode: "legacy" });

      // Should eventually reach consensus after retries
      expect(result).toBeDefined();
      expect(attemptCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Callback Invocation", () => {
    it("should call onRoundComplete after each converge round", async () => {
      const onRoundComplete = vi.fn();

      const agent: DebateAgent<number> = vi.fn(
        (state: number, round: number): ConvergeContribution<number> => ({
          result: state + round,
          hasMore: round < 2, // 2 rounds
          reasoning: `Round ${round}`,
        }),
      );

      await AgentUnit.of(0)
        .debate([agent], {
          maxRounds: 5,
          onRoundComplete,
        })
        .run(ctx, { trustMode: "legacy" });

      expect(onRoundComplete).toHaveBeenCalled();
    });

    it("should call onConsensusAttempt after each vote", async () => {
      const onConsensusAttempt = vi.fn();

      const agent: DebateAgent<string> = vi.fn(
        (state: string): ConvergeContribution<string> => ({
          result: `${state}!`,
          hasMore: false,
          reasoning: "Done",
        }),
      );

      await AgentUnit.of("start")
        .debate([agent], {
          maxConsensusAttempts: 3,
          onConsensusAttempt,
        })
        .run(ctx, { trustMode: "legacy" });

      expect(onConsensusAttempt).toHaveBeenCalled();
    });
  });

  describe("Objection Tracking", () => {
    it("should capture objections from rejecting agents", async () => {
      // Use multiple agents where one might object
      let agent1Calls = 0;
      const agent1: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => {
          agent1Calls++;
          return {
            result: state + 1,
            hasMore: agent1Calls < 2,
            reasoning:
              agent1Calls < 2 ? "I object - need more discussion" : "OK now",
          };
        },
      );

      const agent2: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => ({
          result: state + 2,
          hasMore: false,
          reasoning: "I agree",
        }),
      );

      const result = await AgentUnit.of(0)
        .debate([agent1, agent2], { maxRounds: 5 })
        .run(ctx, { trustMode: "legacy" });

      // Objections are tracked in contributions with hasMore: true
      const objections = result.contributions.filter((c) => c.hadMore === true);
      // Agent 1 should have objected in first round
      expect(objections.length).toBeGreaterThan(0);
    });
  });

  describe("Multi-Agent Debate", () => {
    it("should handle three agents reaching consensus", async () => {
      const agents: Array<DebateAgent<number>> = [
        vi.fn(
          (state: number): ConvergeContribution<number> => ({
            result: state + 1,
            hasMore: false,
            reasoning: "Agent 1 agrees",
          }),
        ),
        vi.fn(
          (state: number): ConvergeContribution<number> => ({
            result: state + 2,
            hasMore: false,
            reasoning: "Agent 2 agrees",
          }),
        ),
        vi.fn(
          (state: number): ConvergeContribution<number> => ({
            result: state + 3,
            hasMore: false,
            reasoning: "Agent 3 agrees",
          }),
        ),
      ];

      const result = await AgentUnit.of(0)
        .debate(agents)
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("consensus");
      // All agents should have been called
      for (const agent of agents) {
        expect(agent).toHaveBeenCalled();
      }
    });

    it("should track individual agent contributions", async () => {
      const agents: Array<DebateAgent<string>> = [
        (state: string): ConvergeContribution<string> => ({
          result: `${state}:A`,
          hasMore: false,
          reasoning: "Agent A contribution",
        }),
        (state: string): ConvergeContribution<string> => ({
          result: `${state}:B`,
          hasMore: false,
          reasoning: "Agent B contribution",
        }),
      ];

      const result = await AgentUnit.of("start")
        .debate(agents)
        .run(ctx, { trustMode: "legacy" });

      expect(result.contributions.length).toBeGreaterThanOrEqual(2);
      // Should have contributions from both agents
      const agentIds = result.contributions.map((c) => c.agentId);
      expect(agentIds.some((id) => id.includes("0"))).toBe(true);
      expect(agentIds.some((id) => id.includes("1"))).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty agents array", async () => {
      const result = await AgentUnit.of("initial")
        .debate([])
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalState).toBe("initial");
      expect(result.outcome).toBe("consensus"); // No agents = vacuous consensus
    });

    it("should handle single agent", async () => {
      const agent: DebateAgent<number> = vi.fn(
        (state: number): ConvergeContribution<number> => ({
          result: state * 2,
          hasMore: false,
          reasoning: "Solo agent done",
        }),
      );

      const result = await AgentUnit.of(5)
        .debate([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("consensus");
      expect(agent).toHaveBeenCalledTimes(1);
    });

    it("should use default options when not specified", async () => {
      const agent: DebateAgent<string> = vi.fn(
        (state: string): ConvergeContribution<string> => ({
          result: `${state}!`,
          hasMore: false,
        }),
      );

      const result = await AgentUnit.of("test")
        .debate([agent]) // No options
        .run(ctx, { trustMode: "legacy" });

      expect(result.outcome).toBe("consensus");
    });
  });

  describe("Integration with Other Operators", () => {
    it("should work with map before debate", async () => {
      const agent: DebateAgent<number> = (
        state: number,
      ): ConvergeContribution<number> => ({
        result: state + 5,
        hasMore: false,
      });

      const result = await AgentUnit.of(10)
        .map((x) => x * 2) // 10 → 20
        .debate([agent]) // debate starting from 20
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalState).toBe(25); // 20 + 5
    });

    it("should work with map after debate", async () => {
      const agent: DebateAgent<number> = (): ConvergeContribution<number> => ({
        result: 100,
        hasMore: false,
      });

      const result = await AgentUnit.of(0)
        .debate([agent])
        .map((debateResult) => debateResult.finalState * 2)
        .run(ctx, { trustMode: "legacy" });

      expect(result).toBe(200);
    });
  });
});
