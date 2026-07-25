/**
 * @fileoverview Tests for AgentUnit.converge() operator
 * @description Iterative boolean convergence - agents refine state until done
 *
 * 📝 BUILD[XX.XX]: Converge operator tests
 *
 * @remarks
 * These tests use `trustMode: 'legacy'` to test basic operator functionality.
 * The converge operator allows multiple agents to iteratively refine state
 * until all agree they're done (hasMore: false).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";
import type { AgentContext, ConvergeContribution } from "../types";

describe("Converge Operator", () => {
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

  describe("Basic Convergence", () => {
    it("should converge when all agents return hasMore: false immediately", async () => {
      const agent1 = vi.fn(
        (state: string): ConvergeContribution<string> => ({
          result: `${state}-a1`,
          hasMore: false,
          reasoning: "Agent 1 done",
        }),
      );
      const agent2 = vi.fn(
        (state: string): ConvergeContribution<string> => ({
          result: `${state}-a2`,
          hasMore: false,
          reasoning: "Agent 2 done",
        }),
      );

      const result = await AgentUnit.of("initial")
        .converge([agent1, agent2])
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
      expect(result.rounds).toBe(1);
      expect(agent1).toHaveBeenCalledTimes(1);
      expect(agent2).toHaveBeenCalledTimes(1);
    });

    it("should track number of rounds", async () => {
      let round1Called = false;
      let round2Called = false;

      const agent = vi.fn(
        (_state: string, round: number): ConvergeContribution<string> => {
          if (round === 1) round1Called = true;
          if (round === 2) round2Called = true;
          return {
            result: `round-${round}`,
            hasMore: round < 2, // Needs 2 rounds
            reasoning: `Round ${round}`,
          };
        },
      );

      const result = await AgentUnit.of("start")
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBe(2);
      expect(round1Called).toBe(true);
      expect(round2Called).toBe(true);
    });

    it("should pass initial value from AgentUnit to agents", async () => {
      const capturedStates: string[] = [];
      const agent = (state: string): ConvergeContribution<string> => {
        capturedStates.push(state);
        return { result: state, hasMore: false };
      };

      await AgentUnit.of("my-initial-value")
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(capturedStates).toContain("my-initial-value");
    });
  });

  describe("Multi-round Convergence", () => {
    it("should continue until all agents return hasMore: false", async () => {
      // Agent 1 needs 2 rounds, Agent 2 needs 3 rounds
      const agent1 = vi.fn(
        (_state: number, round: number): ConvergeContribution<number> => ({
          result: round * 10,
          hasMore: round < 2,
          reasoning: `Agent 1 round ${round}`,
        }),
      );
      const agent2 = vi.fn(
        (_state: number, round: number): ConvergeContribution<number> => ({
          result: round * 100,
          hasMore: round < 3, // Needs 3 rounds
          reasoning: `Agent 2 round ${round}`,
        }),
      );

      const result = await AgentUnit.of(0)
        .converge([agent1, agent2])
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
      expect(result.rounds).toBe(3); // Both must be done
      expect(agent1).toHaveBeenCalledTimes(3);
      expect(agent2).toHaveBeenCalledTimes(3);
    });

    it("should respect maxRounds limit when agents never converge", async () => {
      const neverDoneAgent = vi.fn(
        (): ConvergeContribution<string> => ({
          result: "still going",
          hasMore: true, // Never done
          reasoning: "I never stop",
        }),
      );

      const result = await AgentUnit.of("start")
        .converge([neverDoneAgent], { maxRounds: 3 })
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(false);
      expect(result.rounds).toBe(3);
      expect(neverDoneAgent).toHaveBeenCalledTimes(3);
    });

    it("should use default maxRounds of 5 when not specified", async () => {
      const neverDoneAgent = vi.fn(
        (): ConvergeContribution<string> => ({
          result: "never",
          hasMore: true,
        }),
      );

      const result = await AgentUnit.of("start")
        .converge([neverDoneAgent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBe(5); // Default maxRounds
      expect(neverDoneAgent).toHaveBeenCalledTimes(5);
    });
  });

  describe("Execution Modes", () => {
    it("should execute agents in parallel by default", async () => {
      const executionOrder: string[] = [];
      const delays = [50, 10]; // Agent 0 slower than Agent 1

      const createAgent =
        (id: number) =>
        async (_state: string): Promise<ConvergeContribution<string>> => {
          await new Promise((resolve) => setTimeout(resolve, delays[id]));
          executionOrder.push(`agent-${id}-end`);
          return { result: `${id}`, hasMore: false };
        };

      await AgentUnit.of("start")
        .converge([createAgent(0), createAgent(1)], { parallel: true })
        .run(ctx, { trustMode: "legacy" });

      // In parallel mode, faster agent (1) should finish before slower (0)
      expect(executionOrder).toEqual(["agent-1-end", "agent-0-end"]);
    });

    it("should execute agents sequentially when parallel: false", async () => {
      const executionOrder: string[] = [];

      const createAgent =
        (id: number) =>
        (_state: string): ConvergeContribution<string> => {
          executionOrder.push(`agent-${id}`);
          return { result: `${id}`, hasMore: false };
        };

      await AgentUnit.of("start")
        .converge([createAgent(0), createAgent(1), createAgent(2)], {
          parallel: false,
        })
        .run(ctx, { trustMode: "legacy" });

      // Sequential mode: agents execute in order
      expect(executionOrder).toEqual(["agent-0", "agent-1", "agent-2"]);
    });

    it("should apply state changes immediately in sequential mode", async () => {
      const statesSeen: string[] = [];

      const agent0 = (state: string): ConvergeContribution<string> => {
        statesSeen.push(state);
        return { result: `${state}+A`, hasMore: false };
      };

      const agent1 = (state: string): ConvergeContribution<string> => {
        statesSeen.push(state);
        return { result: `${state}+B`, hasMore: false };
      };

      const result = await AgentUnit.of("start")
        .converge([agent0, agent1], { parallel: false })
        .run(ctx, { trustMode: "legacy" });

      // Sequential: agent1 should see agent0's modified state
      expect(statesSeen).toEqual(["start", "start+A"]);
      expect(result.finalResult).toBe("start+A+B");
    });
  });

  describe("Return Type Handling", () => {
    it("should handle AgentUnit return type", async () => {
      const agent = (state: number): AgentUnit<ConvergeContribution<number>> =>
        AgentUnit.of({
          result: state * 2,
          hasMore: false,
          reasoning: "Doubled via AgentUnit",
        });

      const result = await AgentUnit.of(5)
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toBe(10);
      expect(result.converged).toBe(true);
    });

    it("should handle Promise return type", async () => {
      const agent = async (
        state: number,
      ): Promise<ConvergeContribution<number>> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          result: state + 100,
          hasMore: false,
          reasoning: "Added 100 via Promise",
        };
      };

      const result = await AgentUnit.of(42)
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toBe(142);
      expect(result.converged).toBe(true);
    });

    it("should handle raw value return type", async () => {
      const agent = (state: number): ConvergeContribution<number> => ({
        result: state - 10,
        hasMore: false,
        reasoning: "Subtracted 10 directly",
      });

      const result = await AgentUnit.of(50)
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toBe(40);
      expect(result.converged).toBe(true);
    });

    it("should handle mixed return types in same convergence", async () => {
      const agentUnit = (
        state: number,
      ): AgentUnit<ConvergeContribution<number>> =>
        AgentUnit.of({ result: state + 1, hasMore: false });

      const agentPromise = async (
        state: number,
      ): Promise<ConvergeContribution<number>> => ({
        result: state + 2,
        hasMore: false,
      });

      const agentRaw = (state: number): ConvergeContribution<number> => ({
        result: state + 3,
        hasMore: false,
      });

      const result = await AgentUnit.of(0)
        .converge([agentUnit, agentPromise, agentRaw])
        .run(ctx, { trustMode: "legacy" });

      // In parallel mode, last non-null result wins
      expect(result.converged).toBe(true);
      expect(result.contributions).toHaveLength(3);
    });
  });

  describe("State Transformation", () => {
    it("should pass updated state to next round in parallel mode", async () => {
      const statesPerRound: number[][] = [];

      const agent = (
        state: number,
        round: number,
      ): ConvergeContribution<number> => {
        if (!statesPerRound[round]) statesPerRound[round] = [];
        statesPerRound[round].push(state);
        return { result: state + 10, hasMore: round < 2 };
      };

      await AgentUnit.of(0)
        .converge([agent], { parallel: true })
        .run(ctx, { trustMode: "legacy" });

      // Round 1: sees initial state (0)
      // Round 2: sees state after round 1 (10)
      expect(statesPerRound[1]).toContain(0);
      expect(statesPerRound[2]).toContain(10);
    });

    it("should use last non-null result as new state in parallel mode", async () => {
      const agent0 = (): ConvergeContribution<string> => ({
        result: "first",
        hasMore: false,
      });

      const agent1 = (): ConvergeContribution<string> => ({
        result: "second",
        hasMore: false,
      });

      const result = await AgentUnit.of("initial")
        .converge([agent0, agent1], { parallel: true })
        .run(ctx, { trustMode: "legacy" });

      // Last agent's result wins in parallel mode
      expect(result.finalResult).toBe("second");
    });

    it("should shallow-merge plain object results in parallel mode", async () => {
      const agent0 = (): ConvergeContribution<{
        first?: string;
        second?: string;
      }> => ({
        result: { first: "agent-0" },
        hasMore: false,
      });

      const agent1 = (): ConvergeContribution<{
        first?: string;
        second?: string;
      }> => ({
        result: { second: "agent-1" },
        hasMore: false,
      });

      // F-08 fix: shallow-merge is now opt-in via mergeStrategy: "merge".
      // The old implicit default was silent corruption when agents returned
      // overlapping keys. This test validates the explicit opt-in path.
      const result = await AgentUnit.of({})
        .converge([agent0, agent1], { parallel: true, mergeStrategy: "merge" })
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toEqual({
        first: "agent-0",
        second: "agent-1",
      });
    });
  });

  describe("Contribution Tracking", () => {
    it("should track all contributions with reasoning", async () => {
      const agent0 = (
        _s: string,
        round: number,
      ): ConvergeContribution<string> => ({
        result: "a0",
        hasMore: round < 2,
        reasoning: `Agent 0 reasoning for round ${round}`,
      });

      const agent1 = (
        _s: string,
        round: number,
      ): ConvergeContribution<string> => ({
        result: "a1",
        hasMore: round < 2,
        reasoning: `Agent 1 reasoning for round ${round}`,
      });

      const result = await AgentUnit.of("start")
        .converge([agent0, agent1])
        .run(ctx, { trustMode: "legacy" });

      // 2 rounds × 2 agents = 4 contributions
      expect(result.contributions).toHaveLength(4);

      // Check round 1 contributions
      const round1 = result.contributions.filter((c) => c.round === 1);
      expect(round1).toHaveLength(2);
      expect(round1[0].hadMore).toBe(true);
      expect(round1[0].reasoning).toContain("round 1");

      // Check round 2 contributions
      const round2 = result.contributions.filter((c) => c.round === 2);
      expect(round2).toHaveLength(2);
      expect(round2[0].hadMore).toBe(false);
      expect(round2[0].reasoning).toContain("round 2");
    });

    it("should assign unique agentIds to each agent", async () => {
      const agents = [
        (): ConvergeContribution<number> => ({ result: 1, hasMore: false }),
        (): ConvergeContribution<number> => ({ result: 2, hasMore: false }),
        (): ConvergeContribution<number> => ({ result: 3, hasMore: false }),
      ];

      const result = await AgentUnit.of(0)
        .converge(agents)
        .run(ctx, { trustMode: "legacy" });

      const agentIds = result.contributions.map((c) => c.agentId);
      expect(agentIds).toContain("agent-0");
      expect(agentIds).toContain("agent-1");
      expect(agentIds).toContain("agent-2");
    });

    it("should track hadMore correctly for each contribution", async () => {
      // Agent that converges after round 2
      const agent = (
        _s: number,
        round: number,
      ): ConvergeContribution<number> => ({
        result: round,
        hasMore: round < 2,
      });

      const result = await AgentUnit.of(0)
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.contributions).toHaveLength(2);
      expect(result.contributions[0].hadMore).toBe(true); // Round 1
      expect(result.contributions[1].hadMore).toBe(false); // Round 2
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty agents array", async () => {
      const result = await AgentUnit.of("initial")
        .converge([])
        .run(ctx, { trustMode: "legacy" });

      // With no agents, should return initial state after 1 round
      expect(result.finalResult).toBe("initial");
      expect(result.rounds).toBe(1);
      expect(result.converged).toBe(true); // No agents means no hasMore: true
      expect(result.contributions).toHaveLength(0);
    });

    it("should handle single agent", async () => {
      const agent = vi.fn(
        (): ConvergeContribution<string> => ({
          result: "solo",
          hasMore: false,
        }),
      );

      const result = await AgentUnit.of("start")
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.converged).toBe(true);
      expect(result.finalResult).toBe("solo");
      expect(agent).toHaveBeenCalledTimes(1);
    });

    it("should handle agents that return undefined reasoning", async () => {
      const agent = (): ConvergeContribution<string> => ({
        result: "no-reason",
        hasMore: false,
        // reasoning intentionally omitted
      });

      const result = await AgentUnit.of("start")
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.contributions[0].reasoning).toBeUndefined();
      expect(result.converged).toBe(true);
    });

    it("should handle maxRounds of 1", async () => {
      const agent = vi.fn(
        (): ConvergeContribution<string> => ({
          result: "one",
          hasMore: true, // Wants more but won't get it
        }),
      );

      const result = await AgentUnit.of("start")
        .converge([agent], { maxRounds: 1 })
        .run(ctx, { trustMode: "legacy" });

      expect(result.rounds).toBe(1);
      expect(result.converged).toBe(false); // Agent wanted more
      expect(agent).toHaveBeenCalledTimes(1);
    });

    it("should preserve complex object state through rounds", async () => {
      interface ComplexState {
        count: number;
        items: string[];
        metadata: { updated: boolean };
      }

      const initial: ComplexState = {
        count: 0,
        items: [],
        metadata: { updated: false },
      };

      const agent = (
        state: ComplexState,
        round: number,
      ): ConvergeContribution<ComplexState> => ({
        result: {
          count: state.count + 1,
          items: [...state.items, `item-${round}`],
          metadata: { updated: true },
        },
        hasMore: round < 2,
      });

      const result = await AgentUnit.of(initial)
        .converge([agent])
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult.count).toBe(2);
      expect(result.finalResult.items).toEqual(["item-1", "item-2"]);
      expect(result.finalResult.metadata.updated).toBe(true);
    });
  });

  describe("F-08 — default merge strategy safety", () => {
    // The old default was a shallow-merge for plain objects, which could silently
    // corrupt results when agents returned overlapping keys with conflicting values.
    // The new default is "last" (final agent's non-null result wins).

    it("default strategy takes the last agent's result (not a merge)", async () => {
      // Two agents both return objects with conflicting keys.
      // With the old implicit shallow-merge, the result would mix both objects.
      // With the new default "last", only the second agent's result survives.
      const agent1 = (): ConvergeContribution<{ x: number; y: number }> => ({
        result: { x: 1, y: 10 },
        hasMore: false,
      });
      const agent2 = (): ConvergeContribution<{ x: number; y: number }> => ({
        result: { x: 2, y: 20 },
        hasMore: false,
      });

      const result = await AgentUnit.of({ x: 0, y: 0 })
        .converge([agent1, agent2])
        .run(ctx, { trustMode: "legacy" });

      // Default "last": agent2's result wins entirely — no field mixing.
      expect(result.finalResult).toEqual({ x: 2, y: 20 });
    });

    it('mergeStrategy: "merge" applies shallow-merge for plain objects', async () => {
      // Explicit "merge" strategy retains the old shallow-merge behavior.
      // Agent1 sets { x: 1 }, agent2 sets { y: 20 } — both fields are preserved.
      const agent1 = (): ConvergeContribution<{ x?: number; y?: number }> => ({
        result: { x: 1 },
        hasMore: false,
      });
      const agent2 = (): ConvergeContribution<{ x?: number; y?: number }> => ({
        result: { y: 20 },
        hasMore: false,
      });

      const result = await AgentUnit.of<{ x?: number; y?: number }>({})
        .converge([agent1, agent2], { mergeStrategy: "merge" })
        .run(ctx, { trustMode: "legacy" });

      // Merge: fields from both agents are present
      expect(result.finalResult).toEqual({ x: 1, y: 20 });
    });

    it('mergeStrategy: "last" explicitly takes the last non-null result', async () => {
      const agent1 = (): ConvergeContribution<string> => ({
        result: "from-agent-1",
        hasMore: false,
      });
      const agent2 = (): ConvergeContribution<string> => ({
        result: "from-agent-2",
        hasMore: false,
      });

      const result = await AgentUnit.of("initial")
        .converge([agent1, agent2], { mergeStrategy: "last" })
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toBe("from-agent-2");
    });
  });

  describe("Integration with Other Operators", () => {
    it("should work with map before converge", async () => {
      const agent = (state: number): ConvergeContribution<number> => ({
        result: state + 5,
        hasMore: false,
      });

      const result = await AgentUnit.of(10)
        .map((x) => x * 2) // 10 → 20
        .converge([agent]) // 20 → 25
        .run(ctx, { trustMode: "legacy" });

      expect(result.finalResult).toBe(25);
    });

    it("should work with map after converge", async () => {
      const agent = (): ConvergeContribution<number> => ({
        result: 100,
        hasMore: false,
      });

      const result = await AgentUnit.of(0)
        .converge([agent])
        .map((convergeResult) => convergeResult.finalResult * 2)
        .run(ctx, { trustMode: "legacy" });

      expect(result).toBe(200);
    });
  });
});
