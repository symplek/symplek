/**
 * @module golden-path.test
 * @description Golden-path test suite for @symplek/pro public API.
 *   Exercises each published primitive on the happy path with no external
 *   provider dependencies — all AI calls are mocked.
 */

import { describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "@symplek/core";
import {
  AntibodyRegistry,
  ConfidentStigmergyLayer,
  createConfidentPheromone,
  tacoConsensus,
} from "../index";
import type {
  AdvisorAgent,
  Critique,
  LeaderAgent,
  SynthesisResponse,
  TaCoVote,
  ThesisResponse,
} from "../types";

const ctx = createContext();

// ─── 1. tacoConsensus happy path ─────────────────────────────────────────────

describe("tacoConsensus", () => {
  it("converges to approved when all voters approve", async () => {
    const mockVoter = vi.fn(
      async (_proposal: string): Promise<TaCoVote> => ({
        agentId: "voter-1",
        decision: "approve",
        rationale: "Looks good",
        confidence: 0.9,
      }),
    );

    const unit = AgentUnit.from(() => Promise.resolve("my-proposal"));
    // tacoConsensus returns a transformer: (unit: AgentUnit<T>) => AgentUnit<TaCoResult>
    const transform = tacoConsensus([mockVoter, mockVoter], { maxRounds: 1 });
    const result = await transform(unit).run(ctx, { trustMode: "legacy" });

    expect(result).toBeDefined();
    expect(result.approved).toBe(true);
    expect(Array.isArray(result.rounds)).toBe(true);
    expect(result.rounds).toHaveLength(1);
    expect(typeof result.finalAgreementLevel).toBe("number");
  });

  it("does not approve when all voters reject", async () => {
    const rejectVoter = vi.fn(
      async (_proposal: string): Promise<TaCoVote> => ({
        agentId: "skeptic",
        decision: "reject",
        rationale: "Not convinced",
        confidence: 0.8,
      }),
    );

    const unit = AgentUnit.from(() => Promise.resolve("risky-proposal"));
    const result = await tacoConsensus([rejectVoter], { maxRounds: 1 })(
      unit,
    ).run(ctx, { trustMode: "legacy" });

    expect(result.approved).toBe(false);
  });

  it("invokes onRoundComplete callback after each round", async () => {
    const onRound = vi.fn();
    const approveVoter = vi.fn(
      async (): Promise<TaCoVote> => ({
        agentId: "a",
        decision: "approve",
        rationale: "ok",
        confidence: 1.0,
      }),
    );

    await tacoConsensus([approveVoter], {
      maxRounds: 1,
      onRoundComplete: onRound,
    })(AgentUnit.from(() => Promise.resolve("plan"))).run(ctx, {
      trustMode: "legacy",
    });

    expect(onRound).toHaveBeenCalledOnce();
  });
});

// ─── 2. ConfidentStigmergyLayer ───────────────────────────────────────────────

describe("ConfidentStigmergyLayer", () => {
  it("deposits and senses a value without throwing", () => {
    const layer = new ConfidentStigmergyLayer();
    expect(() =>
      layer.deposit("signal-key", 42, { confidence: 0.9, source: "agent" }),
    ).not.toThrow();

    const sensed = layer.sense<number>("signal-key");
    expect(sensed).toBeDefined();
    expect(sensed!.value).toBe(42);
  });

  it("createConfidentPheromone returns a pheromone with live confidence", () => {
    const pheromone = createConfidentPheromone("hello", {
      confidence: 0.8,
      source: "verified",
    });
    expect(pheromone.value).toBe("hello");
    expect(typeof pheromone.currentConfidence()).toBe("number");
    expect(pheromone.currentConfidence()).toBeGreaterThan(0);
  });
});

// ─── 3. AntibodyRegistry ─────────────────────────────────────────────────────

describe("AntibodyRegistry", () => {
  it("allows a clean output with no registered patterns", () => {
    const registry = new AntibodyRegistry();
    const result = registry.scan("This is a clean and safe response.");
    expect(result).toBeDefined();
    expect(result.recommendation).toBe("allow");
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it("rejects output matching a registered pattern", () => {
    const registry = new AntibodyRegistry();
    registry.registerPattern({
      id: "test-xss",
      matcher: { type: "regex", pattern: /<script[^>]*>/i },
      description: "XSS injection",
      severity: "critical",
      learnedAt: Date.now(),
    });

    const result = registry.scan("<script>alert(1)</script>");
    expect(result.recommendation).toBe("reject");
    expect(result.matches).toHaveLength(1);
  });
});

// ─── 3b. dialectic operator (AgentUnit method, premium test context) ─────────

describe("AgentUnit.dialectic (pro golden-path)", () => {
  it("produces a DialecticResult with thesis, outcome, and rounds", async () => {
    const leader: LeaderAgent<string> = {
      propose: vi.fn(
        async (
          input: string,
          _round: number,
        ): Promise<ThesisResponse<string>> => ({
          thesis: `Thesis: ${input}`,
          reasoning: "Golden-path leader reasoning",
        }),
      ),
      synthesize: vi.fn(
        async (
          thesis: string,
          critiques: Critique[],
        ): Promise<SynthesisResponse<string>> => ({
          synthesis: `Final: ${thesis} (${critiques.length} critiques)`,
          satisfied: true,
          reasoning: "Leader satisfied after one round",
        }),
      ),
    };

    const advisor: AdvisorAgent<string> = vi.fn(
      async (thesis: string, round: number): Promise<Critique> => ({
        advisorId: `golden-advisor-${round}`,
        critique: `Review of: ${thesis}`,
        severity: "minor",
        suggestions: ["Looks good"],
      }),
    );

    // AgentUnit.dialectic is added via prototype augmentation inside @symplek/core.
    // The module declaration (`declare module "../AgentUnit"`) uses a relative path
    // that TypeScript cannot resolve across the package boundary from dist/index.d.ts,
    // so we cast through unknown to satisfy the type checker. Runtime behaviour is correct.
    const unit = AgentUnit.of("analyze this proposal") as unknown as {
      dialectic(
        leader: LeaderAgent<string>,
        advisors: AdvisorAgent<string>[],
        opts?: import("../types").DialecticOptions,
      ): {
        run(
          ctx: ReturnType<typeof createContext>,
          opts: object,
        ): Promise<import("../types").DialecticResult<string>>;
      };
    };
    const result = await unit
      .dialectic(leader, [advisor])
      .run(ctx, { trustMode: "legacy" });

    expect(result).toBeDefined();
    expect(result.outcome).toBe("satisfied");
    expect(result.rounds).toBe(1);
    expect(result.finalThesis).toBeDefined();
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history).toHaveLength(1);
    expect(leader.propose).toHaveBeenCalledOnce();
    expect(leader.synthesize).toHaveBeenCalledOnce();
  });

  it("reaches max-rounds when leader is never satisfied", async () => {
    const unsatisfiedLeader: LeaderAgent<string> = {
      propose: vi.fn(
        async (input: string): Promise<ThesisResponse<string>> => ({
          thesis: `Thesis: ${input}`,
          reasoning: "Proposing",
        }),
      ),
      synthesize: vi.fn(
        async (thesis: string): Promise<SynthesisResponse<string>> => ({
          synthesis: thesis,
          satisfied: false,
          reasoning: "Not satisfied",
        }),
      ),
    };

    // Same cross-package prototype augmentation cast as above
    const unit2 = AgentUnit.of("hard problem") as unknown as {
      dialectic(
        leader: LeaderAgent<string>,
        advisors: AdvisorAgent<string>[],
        opts?: import("../types").DialecticOptions,
      ): {
        run(
          ctx: ReturnType<typeof createContext>,
          opts: object,
        ): Promise<import("../types").DialecticResult<string>>;
      };
    };
    const result = await unit2
      .dialectic(unsatisfiedLeader, [], { maxRounds: 2 })
      .run(ctx, { trustMode: "legacy" });

    expect(result.rounds).toBe(2);
    expect(result.outcome).toBe("max-rounds");
  });
});

// ─── 4. observability traces — MOVED TO @symplek/core ───────────────────────────
// See packages/symplek-core/src/__tests__/observability.test.ts for coverage.
