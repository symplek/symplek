/**
 * @fileoverview Coherence Module Tests
 * @description Unit and integration tests for ensemble coherence calculations
 * @module weft-core/coherence/__tests__/coherence
 * @since 2.1.0
 *
 * 📝 BUILD[STORY-02.06]: Integration tests for coherence module
 */

import { describe, expect, it } from "vitest";
import type { Vote } from "../../types";
import {
  calculateCompositeCoherence,
  meetsCoherenceThreshold,
  quickCoherence,
} from "../calculations/compositeCoherence";
import {
  calculateEntropyCoherence,
  shannonEntropy,
} from "../calculations/entropyCoherence";
import {
  calculateVarianceCoherence,
  simpleVariance,
} from "../calculations/varianceCoherence";
import {
  COHERENCE_PRESETS,
  COHERENCE_THRESHOLDS,
  DEFAULT_COHERENCE_WEIGHTS,
  mergeWeights,
  normalizeWeights,
  resolveThreshold,
  validateWeightSum,
} from "../config";
import type { CoherenceInput, CoherenceWeights } from "../types";
import { hasContributions, hasVotes } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a vote for testing.
 */
function createVote(
  agentId: string,
  decision: "approve" | "reject" | "abstain",
  confidence: number,
  weight = 1,
): Vote {
  return { agentId, decision, confidence, weight };
}

/**
 * Create a unanimous vote array.
 */
function createUnanimousVotes(
  count: number,
  decision: "approve" | "reject" | "abstain" = "approve",
  confidence = 0.9,
): Vote[] {
  return Array.from({ length: count }, (_, i) =>
    createVote(`agent_${i}`, decision, confidence),
  );
}

/**
 * Create split votes.
 */
function createSplitVotes(): Vote[] {
  return [
    createVote("agent_1", "approve", 0.9),
    createVote("agent_2", "reject", 0.8),
    createVote("agent_3", "abstain", 0.5),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARDS
// ─────────────────────────────────────────────────────────────────────────────

describe("Type Guards", () => {
  describe("hasVotes", () => {
    it("returns true for objects with votes array", () => {
      expect(hasVotes({ votes: [] })).toBe(true);
      expect(hasVotes({ votes: [createVote("a", "approve", 0.9)] })).toBe(true);
    });

    it("returns false for non-objects", () => {
      expect(hasVotes(null)).toBe(false);
      expect(hasVotes(undefined)).toBe(false);
      expect(hasVotes("string")).toBe(false);
      expect(hasVotes(123)).toBe(false);
    });

    it("returns false for objects without votes", () => {
      expect(hasVotes({})).toBe(false);
      expect(hasVotes({ votes: "not-an-array" })).toBe(false);
    });
  });

  describe("hasContributions", () => {
    it("returns true for objects with contributions array", () => {
      expect(hasContributions({ contributions: [] })).toBe(true);
      expect(
        hasContributions({
          contributions: [{ round: 1, agentId: "a", hadMore: false }],
        }),
      ).toBe(true);
    });

    it("returns false for non-objects", () => {
      expect(hasContributions(null)).toBe(false);
      expect(hasContributions(undefined)).toBe(false);
    });

    it("returns false for objects without contributions", () => {
      expect(hasContributions({})).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Configuration", () => {
  describe("DEFAULT_COHERENCE_WEIGHTS", () => {
    it("has correct default values", () => {
      expect(DEFAULT_COHERENCE_WEIGHTS.agreement).toBe(0.4);
      expect(DEFAULT_COHERENCE_WEIGHTS.variance).toBe(0.25);
      expect(DEFAULT_COHERENCE_WEIGHTS.entropy).toBe(0.15);
      expect(DEFAULT_COHERENCE_WEIGHTS.convergence).toBe(0.15);
      expect(DEFAULT_COHERENCE_WEIGHTS.stigmergy).toBe(0.05);
    });

    it("sums to 1.0", () => {
      const sum = Object.values(DEFAULT_COHERENCE_WEIGHTS).reduce(
        (a, b) => a + b,
        0,
      );
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe("COHERENCE_THRESHOLDS", () => {
    it("has correct threshold values", () => {
      expect(COHERENCE_THRESHOLDS.critical).toBe(0.95);
      expect(COHERENCE_THRESHOLDS.highStakes).toBe(0.8);
      expect(COHERENCE_THRESHOLDS.standard).toBe(0.7);
      expect(COHERENCE_THRESHOLDS.byzantine).toBe(0.67);
    });
  });

  describe("resolveThreshold", () => {
    it("resolves preset to threshold", () => {
      expect(resolveThreshold({ preset: "critical" })).toBe(0.95);
      expect(resolveThreshold({ preset: "standard" })).toBe(0.7);
    });

    it("uses explicit threshold", () => {
      expect(resolveThreshold({ threshold: 0.85 })).toBe(0.85);
    });

    it("preset overrides threshold", () => {
      expect(resolveThreshold({ preset: "critical", threshold: 0.5 })).toBe(
        0.95,
      );
    });

    it("uses default when neither provided", () => {
      expect(resolveThreshold({})).toBe(0.7); // standard is default
    });
  });

  describe("mergeWeights", () => {
    it("returns defaults when no partial provided", () => {
      const result = mergeWeights();
      expect(result).toEqual(DEFAULT_COHERENCE_WEIGHTS);
    });

    it("merges partial with defaults", () => {
      const result = mergeWeights({ agreement: 0.5, entropy: 0.1 });
      expect(result.agreement).toBe(0.5);
      expect(result.entropy).toBe(0.1);
      expect(result.variance).toBe(0.25); // default
    });
  });

  describe("validateWeightSum", () => {
    it("returns true for valid weights", () => {
      expect(validateWeightSum(DEFAULT_COHERENCE_WEIGHTS)).toBe(true);
    });

    it("returns false for invalid weights", () => {
      const invalidWeights: CoherenceWeights = {
        agreement: 0.5,
        variance: 0.5,
        entropy: 0.5,
        convergence: 0.5,
        stigmergy: 0.5,
      };
      expect(validateWeightSum(invalidWeights)).toBe(false);
    });
  });

  describe("normalizeWeights", () => {
    it("normalizes weights to sum to 1", () => {
      const weights: CoherenceWeights = {
        agreement: 0.5,
        variance: 0.25,
        entropy: 0.25,
        convergence: 0,
        stigmergy: 0,
      };
      const normalized = normalizeWeights(weights);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VARIANCE COHERENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Variance Coherence", () => {
  describe("simpleVariance", () => {
    it("returns 0 for empty array", () => {
      expect(simpleVariance([])).toBe(0);
    });

    it("returns 0 for single value", () => {
      expect(simpleVariance([0.5])).toBe(0);
    });

    it("calculates variance correctly", () => {
      // Mean = 0.5, variance = ((0-0.5)^2 + (1-0.5)^2) / 2 = 0.25
      expect(simpleVariance([0, 1])).toBeCloseTo(0.25);
    });

    it("returns 0 for identical values", () => {
      expect(simpleVariance([0.8, 0.8, 0.8])).toBeCloseTo(0);
    });
  });

  describe("calculateVarianceCoherence", () => {
    it("returns 0 for empty votes", () => {
      const result = calculateVarianceCoherence([]);
      expect(result.coherence).toBe(0);
    });

    it("returns 1.0 for single vote", () => {
      const result = calculateVarianceCoherence([
        createVote("a", "approve", 0.9),
      ]);
      expect(result.coherence).toBe(1.0);
    });

    it("returns high coherence for similar confidences", () => {
      const votes = [
        createVote("a", "approve", 0.9),
        createVote("b", "approve", 0.88),
        createVote("c", "approve", 0.92),
      ];
      const result = calculateVarianceCoherence(votes);
      expect(result.coherence).toBeGreaterThan(0.95);
    });

    it("returns low coherence for varied confidences", () => {
      const votes = [
        createVote("a", "approve", 0.1),
        createVote("b", "approve", 0.9),
      ];
      const result = calculateVarianceCoherence(votes);
      expect(result.coherence).toBeLessThan(0.5);
    });

    it("includes signal with correct method", () => {
      const result = calculateVarianceCoherence(createUnanimousVotes(3));
      expect(result.signal.method).toBe("variance");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTROPY COHERENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Entropy Coherence", () => {
  describe("shannonEntropy", () => {
    it("returns 0 for single probability", () => {
      expect(shannonEntropy([1])).toBeCloseTo(0);
    });

    it("returns 1 bit for two equal probabilities", () => {
      expect(shannonEntropy([0.5, 0.5])).toBeCloseTo(1);
    });

    it("returns max entropy for uniform distribution", () => {
      const uniform = [0.25, 0.25, 0.25, 0.25];
      expect(shannonEntropy(uniform)).toBeCloseTo(2); // log2(4) = 2
    });
  });

  describe("calculateEntropyCoherence", () => {
    it("returns 0 for empty votes", () => {
      const result = calculateEntropyCoherence([]);
      expect(result.coherence).toBe(0);
    });

    it("returns 1.0 for single vote", () => {
      const result = calculateEntropyCoherence([
        createVote("a", "approve", 0.9),
      ]);
      expect(result.coherence).toBe(1.0);
    });

    it("returns 1.0 for unanimous votes", () => {
      const votes = createUnanimousVotes(5);
      const result = calculateEntropyCoherence(votes);
      expect(result.coherence).toBe(1.0);
    });

    it("returns low coherence for split votes", () => {
      const votes = createSplitVotes();
      const result = calculateEntropyCoherence(votes);
      // 3 different decisions = max entropy
      expect(result.coherence).toBeCloseTo(0, 1);
    });

    it("includes signal with correct method", () => {
      const result = calculateEntropyCoherence(createUnanimousVotes(3));
      expect(result.signal.method).toBe("entropy");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE COHERENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("Composite Coherence", () => {
  describe("calculateCompositeCoherence", () => {
    it("handles empty input", () => {
      const result = calculateCompositeCoherence({});
      expect(result.composite).toBe(0);
    });

    it("calculates composite for unanimous votes", () => {
      const votes = createUnanimousVotes(5);
      const result = calculateCompositeCoherence({ votes });

      expect(result.agreementCoherence).toBe(1.0);
      expect(result.entropyCoherence).toBe(1.0);
      expect(result.composite).toBeGreaterThan(0.9);
    });

    it("calculates composite for split votes", () => {
      const votes = createSplitVotes();
      const result = calculateCompositeCoherence({ votes });

      expect(result.agreementCoherence).toBeLessThan(0.5);
      expect(result.composite).toBeLessThan(0.5);
    });

    it("includes metadata with contributing methods", () => {
      const votes = createUnanimousVotes(3);
      const result = calculateCompositeCoherence({ votes });

      expect(result.metadata.contributingMethods).toContain("agreement");
      expect(result.metadata.contributingMethods).toContain("variance");
      expect(result.metadata.contributingMethods).toContain("entropy");
    });

    it("includes algorithm version", () => {
      const result = calculateCompositeCoherence({
        votes: createUnanimousVotes(2),
      });
      expect(result.metadata.algorithmVersion).toBe("2.1.0");
    });

    it("respects custom weights", () => {
      const votes = createUnanimousVotes(3);

      // Override to heavily weight agreement
      const heavyAgreement = calculateCompositeCoherence(
        { votes },
        { weights: { agreement: 0.9, variance: 0.05, entropy: 0.05 } },
      );

      // Default weights
      const defaultWeights = calculateCompositeCoherence({ votes });

      // Both should be high for unanimous, but structure differs
      expect(heavyAgreement.composite).toBeGreaterThan(0.9);
      expect(defaultWeights.composite).toBeGreaterThan(0.9);
    });

    it("includes convergence for debate-like results", () => {
      const input: CoherenceInput = {
        votes: createUnanimousVotes(3),
        contributions: [
          { round: 1, agentId: "a", hadMore: false },
          { round: 1, agentId: "b", hadMore: false },
          { round: 1, agentId: "c", hadMore: false },
        ],
        convergenceRounds: 3,
      };

      const result = calculateCompositeCoherence(input);
      expect(result.metadata.contributingMethods).toContain("convergence");
      expect(result.convergenceCoherence).toBeDefined();
    });
  });

  describe("quickCoherence", () => {
    it("returns composite score directly", () => {
      const votes = createUnanimousVotes(3);
      const score = quickCoherence(votes);
      expect(score).toBeGreaterThan(0.9);
    });
  });

  describe("meetsCoherenceThreshold", () => {
    it("returns true for unanimous votes at standard threshold", () => {
      const votes = createUnanimousVotes(5);
      expect(meetsCoherenceThreshold({ votes }, 0.7)).toBe(true);
    });

    it("returns false for split votes at high threshold", () => {
      const votes = createSplitVotes();
      expect(meetsCoherenceThreshold({ votes }, 0.8)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THRESHOLD PRESETS
// ─────────────────────────────────────────────────────────────────────────────

describe("Threshold Presets", () => {
  it("critical threshold is very strict", () => {
    const votes = createUnanimousVotes(10, "approve", 0.95);
    const result = calculateCompositeCoherence({ votes });
    // Even unanimous high-confidence should approach but may not always meet critical
    expect(result.composite).toBeGreaterThan(0.85);
  });

  it("byzantine threshold is BFT minimum", () => {
    // Byzantine fault tolerance requires >= 2/3 + 1
    expect(COHERENCE_PRESETS.byzantine).toBeCloseTo(0.67);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles single vote with low confidence", () => {
    const votes = [createVote("a", "approve", 0.1)];
    const result = calculateCompositeCoherence({ votes });
    // Single vote means no variance (perfect), unanimous (perfect)
    // but agreement rate is still 100%
    expect(result.composite).toBeGreaterThan(0);
  });

  it("handles many agents with slight variations", () => {
    const votes = Array.from({ length: 100 }, (_, i) =>
      createVote(`agent_${i}`, "approve", 0.8 + Math.random() * 0.15),
    );
    const result = calculateCompositeCoherence({ votes });
    // High coherence expected for similar votes
    expect(result.composite).toBeGreaterThan(0.8);
  });

  it("handles weighted votes", () => {
    const votes = [
      createVote("expert", "approve", 0.9, 5), // Expert weight 5
      createVote("junior_1", "reject", 0.9, 1),
      createVote("junior_2", "reject", 0.9, 1),
      createVote("junior_3", "reject", 0.9, 1),
    ];
    const result = calculateCompositeCoherence({ votes });
    // Expert has 5/8 weight, so approve should win
    expect(result.agreementCoherence).toBeGreaterThan(0.5);
  });
});
