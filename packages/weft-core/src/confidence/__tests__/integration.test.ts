/**
 * @fileoverview Integration tests for objective confidence in operators
 * @description Verifies that objective confidence flows correctly through
 * consensus, debate, and dialectic operators.
 *
 * Story 02.06: Integration tests for operators
 */

import { describe, expect, it } from "vitest";
import type { AgentUnitMetadata } from "../../AgentUnit";
import {
  createConsensusComputation,
  createDebateComputation,
  createDialecticComputation,
} from "../../operators";
import type { AgentContext, VoteInput } from "../../types";

// Mock context for testing
const mockCtx: AgentContext = {
  sessionId: "test-session",
  timestamp: Date.now(),
  metadata: {},
};

// Mock metadata
const mockMeta: AgentUnitMetadata = {
  id: "test-unit",
  operatorChain: [],
  createdAt: Date.now(),
};

describe("Objective Confidence Integration", () => {
  describe("Consensus Operator", () => {
    it("should include objectiveConfidence in ConsensusResult when approved", async () => {
      // Create mock voters that approve
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
          reasoning: "Looks good",
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.85,
          reasoning: "I agree",
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.95,
          reasoning: "Excellent",
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.5 },
      );

      const result = await computation(mockCtx);

      expect(result.approved).toBe(true);
      expect(result.objectiveConfidence).toBeDefined();
      expect(result.objectiveConfidence?.composite).toBeGreaterThan(0);
      expect(result.objectiveConfidence?.composite).toBeLessThanOrEqual(1);
      expect(result.objectiveConfidence?.agreementRate).toBeDefined();
      expect(result.objectiveConfidence?.metadata).toBeDefined();
    });

    it("should include objectiveConfidence in ConsensusResult when rejected", async () => {
      // Create mock voters that reject
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "reject",
          confidence: 0.8,
          reasoning: "Too risky",
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "reject",
          confidence: 0.7,
          reasoning: "I disagree",
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.6,
          reasoning: "Maybe",
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.8 }, // High quorum means this will fail
      );

      const result = await computation(mockCtx);

      expect(result.approved).toBe(false);
      expect(result.objectiveConfidence).toBeDefined();
      // With 1 approve and 2 rejects, the majority decision is "reject" (2/3 = 66.7% agreed)
      // Agreement rate measures consensus around the majority decision
      expect(result.objectiveConfidence?.agreementRate).toBeCloseTo(0.667, 1);
    });

    it("should include objectiveConfidence with veto", async () => {
      // Veto is triggered by a "reject" decision from an agent in the vetoers list
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "reject", // Must be "reject" for veto detection
          confidence: 1.0,
          reasoning: "Absolutely not",
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.5, vetoers: ["voter_0"] }, // Note: voter_${index} format
      );

      const result = await computation(mockCtx);

      expect(result.approved).toBe(false);
      expect(result.consensus).toBe("vetoed");
      expect(result.objectiveConfidence).toBeDefined();
    });

    it("should have unanimous approval reflected in high agreement rate", async () => {
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.5 },
      );

      const result = await computation(mockCtx);

      expect(result.approved).toBe(true);
      expect(result.objectiveConfidence?.agreementRate).toBe(1.0); // 100% agreement
    });
  });

  describe("Debate Operator", () => {
    it("should include objectiveConfidence in DebateResult with empty agents", async () => {
      const computation = createDebateComputation(
        { value: 0 },
        [], // No agents - vacuous consensus
        { maxRounds: 5 },
      );

      const result = await computation(mockCtx);

      expect(result.outcome).toBe("consensus");
      expect(result.objectiveConfidence).toBeDefined();
      // With no votes, agreement rate is 0 (no data to measure)
      // This is correct - vacuous consensus doesn't mean perfect agreement
      expect(result.objectiveConfidence?.agreementRate).toBe(0);
    });

    it("should include objectiveConfidence with single converging agent", async () => {
      let callCount = 0;
      const agent = (_state: { value: number }, _round: number) => {
        callCount++;
        return Promise.resolve({
          result: { value: callCount },
          hasMore: callCount < 2, // Converge after 2 calls
          reasoning: `Iteration ${callCount}`,
        });
      };

      const computation = createDebateComputation({ value: 0 }, [agent], {
        maxRounds: 5,
        maxConsensusAttempts: 1,
      });

      const result = await computation(mockCtx);

      expect(result.objectiveConfidence).toBeDefined();
      expect(result.objectiveConfidence?.composite).toBeGreaterThan(0);
    });
  });

  describe("Dialectic Operator", () => {
    it("should include objectiveConfidence when leader is satisfied", async () => {
      const leader = {
        propose: async (_problem: string, _round: number) => ({
          thesis: "Initial thesis",
        }),
        synthesize: async (_thesis: string, _critiques: unknown[]) => ({
          synthesis: "Final synthesis",
          satisfied: true,
        }),
      };

      const advisors = [
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-0",
          critique: "Minor suggestion",
          severity: "minor" as const,
        }),
      ];

      const computation = createDialecticComputation(
        "Problem",
        leader,
        advisors,
        {
          maxRounds: 5,
          terminationMode: "leader-satisfied",
        },
      );

      const result = await computation(mockCtx);

      expect(result.outcome).toBe("satisfied");
      expect(result.objectiveConfidence).toBeDefined();
    });

    it("should include objectiveConfidence in consensus mode", async () => {
      const leader = {
        propose: async (_problem: string, _round: number) => ({
          thesis: "Initial thesis",
        }),
        synthesize: async (_thesis: string, _critiques: unknown[]) => ({
          synthesis: "Final synthesis",
          satisfied: false,
        }),
      };

      const advisors = [
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-0",
          critique: "Looks good",
          severity: "minor" as const, // Minor = approve
        }),
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-1",
          critique: "I agree",
          severity: "none" as const, // None = approve
        }),
      ];

      const computation = createDialecticComputation(
        "Problem",
        leader,
        advisors,
        {
          maxRounds: 5,
          terminationMode: "consensus",
        },
      );

      const result = await computation(mockCtx);

      expect(result.outcome).toBe("consensus");
      expect(result.objectiveConfidence).toBeDefined();
      expect(result.finalVotes).toBeDefined();
      // All advisors approved (no blocking/major critiques)
      expect(result.objectiveConfidence?.agreementRate).toBe(1.0);
    });

    it("should include objectiveConfidence in majority mode", async () => {
      const leader = {
        propose: async (_problem: string, _round: number) => ({
          thesis: "Thesis",
        }),
        synthesize: async (_thesis: string, _critiques: unknown[]) => ({
          synthesis: "Synthesis",
          satisfied: false,
        }),
      };

      const advisors = [
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-0",
          critique: "Blocking issue",
          severity: "blocking" as const, // Blocking = reject
        }),
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-1",
          critique: "Looks fine",
          severity: "minor" as const, // Minor = approve
        }),
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-2",
          critique: "Good",
          severity: "none" as const, // None = approve
        }),
      ];

      const computation = createDialecticComputation(
        "Problem",
        leader,
        advisors,
        {
          maxRounds: 5,
          terminationMode: "majority",
          quorum: 0.5, // 50% needed
        },
      );

      const result = await computation(mockCtx);

      expect(result.outcome).toBe("majority");
      expect(result.objectiveConfidence).toBeDefined();
      // 2/3 approved = 66.7% agreement
      expect(result.objectiveConfidence?.agreementRate).toBeCloseTo(0.667, 1);
    });

    it("should include objectiveConfidence on max-rounds", async () => {
      const leader = {
        propose: async (_problem: string, _round: number) => ({
          thesis: "Thesis",
        }),
        synthesize: async (_thesis: string, _critiques: unknown[]) => ({
          synthesis: "Synthesis",
          satisfied: false, // Never satisfied
        }),
      };

      const advisors = [
        async (_thesis: string, _round: number) => ({
          advisorId: "advisor-0",
          critique: "Still issues",
          severity: "major" as const, // Major = reject
        }),
      ];

      const computation = createDialecticComputation(
        "Problem",
        leader,
        advisors,
        {
          maxRounds: 2, // Very few rounds
          terminationMode: "consensus", // Will never reach
        },
      );

      const result = await computation(mockCtx);

      expect(result.outcome).toBe("max-rounds");
      expect(result.objectiveConfidence).toBeDefined();
    });
  });

  describe("Metadata Quality", () => {
    it("should include complete metadata in objectiveConfidence", async () => {
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.8,
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.5 },
      );

      const result = await computation(mockCtx);

      const metadata = result.objectiveConfidence?.metadata;
      expect(metadata).toBeDefined();
      expect(metadata?.calculatedAt).toBeGreaterThan(0);
      // contributingTiers contains tier names like 'immediate', 'statistical', 'behavioral'
      expect(metadata?.contributingTiers).toContain("immediate");
      // Formula uses × (multiplication sign) not *
      expect(metadata?.formula).toContain("×");
      expect(metadata?.signals.length).toBeGreaterThan(0);
    });

    it("should include tier breakdown in signals", async () => {
      const voters = [
        async (_proposal: number): Promise<VoteInput> => ({
          decision: "approve",
          confidence: 0.9,
        }),
      ];

      const computation = createConsensusComputation(
        async () => 42,
        voters,
        mockMeta,
        { quorum: 0.5 },
      );

      const result = await computation(mockCtx);

      const signals = result.objectiveConfidence?.metadata.signals;
      expect(signals).toBeDefined();
      // Signals have numeric tiers (1, 2, 3, 4), not string names
      expect(signals?.some((s) => s.tier === 1)).toBe(true); // Tier 1 = immediate
      expect(signals?.every((s) => s.tier !== undefined)).toBe(true);
      expect(signals?.every((s) => s.inputs !== undefined)).toBe(true);
    });
  });
});
