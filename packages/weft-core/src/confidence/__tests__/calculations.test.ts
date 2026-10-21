/**
 * @fileoverview Unit Tests for Objective Confidence Calculations
 * @description Tests for all confidence calculation functions
 * @module @symplek/core/confidence/__tests__/calculations
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[01.10]: Unit tests for confidence module
 */

import { describe, expect, it } from "vitest";
import type { Vote } from "../../types";

// Import all calculation functions
import {
  calculateAgreementRate,
  isUnanimous,
  simpleAgreementRate,
} from "../calculations/agreementRate";
import {
  calculateObjectiveConfidence,
  getConfidenceTier,
  meetsThreshold,
  quickConfidence,
} from "../calculations/composite";
import {
  calculateEntropyConfidence,
  shannonEntropy,
} from "../calculations/entropyConfidence";

import {
  calculateRetryConfidence,
  calculateVerificationDepthConfidence,
} from "../calculations/retryConfidence";
import {
  calculateVarianceConfidence,
  extractConfidencesFromVotes,
  simpleVariance,
} from "../calculations/varianceConfidence";

// Config imports
import {
  DEFAULT_WEIGHTS,
  getPresetWeights,
  normalizeWeights,
  validateWeights,
} from "../config";

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/** Create a mock vote for testing */
function createVote(
  decision: "approve" | "reject" | "abstain",
  confidence: number,
  agentId: string = `agent-${Math.random().toString(36).slice(2, 8)}`,
  weight: number = 1,
): Vote {
  return { agentId, decision, confidence, weight };
}

/** Create unanimous approval votes */
function createUnanimousApprove(count: number): Vote[] {
  return Array.from({ length: count }, (_, i) =>
    createVote("approve", 0.9, `agent-${i}`),
  );
}

/** Create split votes (approve vs reject) */
function createSplitVotes(approveCount: number, rejectCount: number): Vote[] {
  const votes: Vote[] = [];
  for (let i = 0; i < approveCount; i++) {
    votes.push(createVote("approve", 0.8, `approver-${i}`));
  }
  for (let i = 0; i < rejectCount; i++) {
    votes.push(createVote("reject", 0.7, `rejector-${i}`));
  }
  return votes;
}

// ─────────────────────────────────────────────────────────────────────────────
// AGREEMENT RATE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Agreement Rate Calculation", () => {
  describe("calculateAgreementRate", () => {
    it("returns 0 for empty votes", () => {
      const result = calculateAgreementRate([]);
      expect(result.agreementRate).toBe(0);
      expect(result.majorityDecision).toBeNull();
    });

    it("returns 1.0 for unanimous votes", () => {
      const votes = createUnanimousApprove(5);
      const result = calculateAgreementRate(votes);
      expect(result.agreementRate).toBe(1.0);
      expect(result.majorityDecision).toBe("approve");
      expect(result.majorityCount).toBe(5);
    });

    it("calculates correct rate for split votes", () => {
      const votes = createSplitVotes(3, 2); // 3 approve, 2 reject
      const result = calculateAgreementRate(votes);
      expect(result.agreementRate).toBe(0.6); // 3/5
      expect(result.majorityDecision).toBe("approve");
    });

    it("handles weighted votes", () => {
      const votes: Vote[] = [
        createVote("approve", 0.9, "a1", 2), // weight 2
        createVote("reject", 0.8, "a2", 1), // weight 1
      ];
      const result = calculateAgreementRate(votes);
      expect(result.agreementRate).toBeCloseTo(2 / 3); // 2/(2+1)
    });

    it("includes audit signal", () => {
      const votes = createSplitVotes(2, 1);
      const result = calculateAgreementRate(votes, 0.3);
      expect(result.signal.tier).toBe(1);
      expect(result.signal.weight).toBe(0.3);
      expect(result.signal.formula).toContain("agreementRate");
    });
  });

  describe("simpleAgreementRate", () => {
    it("returns simple rate without audit trail", () => {
      const votes = createSplitVotes(4, 1);
      const rate = simpleAgreementRate(votes);
      expect(rate).toBe(0.8);
    });
  });

  describe("isUnanimous", () => {
    it("returns true for unanimous votes", () => {
      const votes = createUnanimousApprove(3);
      expect(isUnanimous(votes)).toBe(true);
    });

    it("returns false for split votes", () => {
      const votes = createSplitVotes(4, 1);
      expect(isUnanimous(votes)).toBe(false);
    });

    it("supports custom threshold", () => {
      const votes = createSplitVotes(4, 1); // 80% agree
      expect(isUnanimous(votes, 0.8)).toBe(true);
      expect(isUnanimous(votes, 0.9)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTROPY CONFIDENCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Entropy Confidence Calculation", () => {
  describe("calculateEntropyConfidence", () => {
    it("returns 0 for empty votes", () => {
      const result = calculateEntropyConfidence([]);
      expect(result.entropyConfidence).toBe(0);
    });

    it("returns 1.0 for unanimous votes", () => {
      const votes = createUnanimousApprove(5);
      const result = calculateEntropyConfidence(votes);
      expect(result.entropyConfidence).toBe(1.0);
      expect(result.entropy).toBe(0);
    });

    it("returns lower confidence for split votes", () => {
      const votes = createSplitVotes(2, 2); // Perfect split
      const result = calculateEntropyConfidence(votes);
      expect(result.entropyConfidence).toBe(0); // Max entropy = 0 confidence
      expect(result.normalizedEntropy).toBe(1);
    });

    it("handles three-way split", () => {
      const votes: Vote[] = [
        createVote("approve", 0.9, "a1"),
        createVote("reject", 0.8, "a2"),
        createVote("abstain", 0.7, "a3"),
      ];
      const result = calculateEntropyConfidence(votes);
      expect(result.entropyConfidence).toBe(0); // 3-way split = max entropy
      expect(result.maxEntropy).toBeCloseTo(Math.log2(3));
    });
  });

  describe("shannonEntropy", () => {
    it("calculates binary entropy correctly", () => {
      const entropy = shannonEntropy([0.5, 0.5]);
      expect(entropy).toBeCloseTo(1.0); // 1 bit for fair coin
    });

    it("returns 0 for certain outcome", () => {
      const entropy = shannonEntropy([1.0, 0.0]);
      expect(entropy).toBe(0);
    });

    it("calculates skewed distribution", () => {
      const entropy = shannonEntropy([0.9, 0.1]);
      expect(entropy).toBeCloseTo(0.469, 2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VARIANCE CONFIDENCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Variance Confidence Calculation", () => {
  describe("calculateVarianceConfidence", () => {
    it("returns 1.0 for single prediction", () => {
      const result = calculateVarianceConfidence([0.5]);
      expect(result.varianceConfidence).toBe(1.0);
      expect(result.variance).toBe(0);
    });

    it("returns high confidence for low variance", () => {
      const result = calculateVarianceConfidence([0.85, 0.86, 0.84, 0.85]);
      expect(result.varianceConfidence).toBeGreaterThan(0.99);
    });

    it("returns low confidence for high variance", () => {
      const result = calculateVarianceConfidence([0.1, 0.5, 0.9], 0.25);
      expect(result.varianceConfidence).toBeLessThan(0.5);
    });

    it("uses custom maxVariance", () => {
      const predictions = [0.2, 0.4, 0.6, 0.8];
      const result1 = calculateVarianceConfidence(predictions, 0.1);
      const result2 = calculateVarianceConfidence(predictions, 1.0);
      expect(result1.varianceConfidence).toBeLessThan(
        result2.varianceConfidence,
      );
    });
  });

  describe("simpleVariance", () => {
    it("calculates sample variance", () => {
      const variance = simpleVariance([2, 4, 6, 8, 10]);
      expect(variance).toBe(10); // Known value
    });

    it("returns 0 for single value", () => {
      expect(simpleVariance([5])).toBe(0);
    });
  });

  describe("extractConfidencesFromVotes", () => {
    it("extracts confidence values", () => {
      const votes: Vote[] = [
        createVote("approve", 0.9, "a1"),
        createVote("approve", 0.8, "a2"),
        createVote("reject", 0.7, "a3"),
      ];
      const confidences = extractConfidencesFromVotes(votes);
      expect(confidences).toEqual([0.9, 0.8, 0.7]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RETRY CONFIDENCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Retry Confidence Calculation", () => {
  describe("calculateRetryConfidence (exponential)", () => {
    it("returns 1.0 for zero retries", () => {
      const result = calculateRetryConfidence(0);
      expect(result.retryConfidence).toBe(1.0);
    });

    it("decays exponentially", () => {
      const result1 = calculateRetryConfidence(1);
      const result2 = calculateRetryConfidence(2);
      const result3 = calculateRetryConfidence(3);

      expect(result1.retryConfidence).toBeCloseTo(0.606, 2);
      expect(result2.retryConfidence).toBeCloseTo(0.368, 2);
      expect(result3.retryConfidence).toBeCloseTo(0.223, 2);
    });

    it("respects confidence floor", () => {
      const result = calculateRetryConfidence(100, { floor: 0.1 });
      expect(result.retryConfidence).toBe(0.1);
    });

    it("uses custom lambda", () => {
      const slow = calculateRetryConfidence(2, { lambda: 0.25 });
      const fast = calculateRetryConfidence(2, { lambda: 1.0 });
      expect(slow.retryConfidence).toBeGreaterThan(fast.retryConfidence);
    });
  });

  describe("calculateRetryConfidence (linear)", () => {
    it("decays linearly", () => {
      const result = calculateRetryConfidence(2, {
        model: "linear",
        maxRetries: 5,
      });
      expect(result.retryConfidence).toBeCloseTo(0.6);
    });
  });

  describe("calculateVerificationDepthConfidence", () => {
    it("increases with more verification steps", () => {
      const result0 = calculateVerificationDepthConfidence(0);
      const result1 = calculateVerificationDepthConfidence(1);
      const result3 = calculateVerificationDepthConfidence(3);

      expect(result0.verificationConfidence).toBe(0);
      expect(result1.verificationConfidence).toBeCloseTo(0.333, 2);
      expect(result3.verificationConfidence).toBe(1.0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE CONFIDENCE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Composite Confidence Calculation", () => {
  describe("calculateObjectiveConfidence", () => {
    it("returns 0 for empty input", () => {
      const result = calculateObjectiveConfidence({});
      expect(result.composite).toBe(0);
    });

    it("calculates from votes only", () => {
      const votes = createUnanimousApprove(5);
      const result = calculateObjectiveConfidence({ votes });

      expect(result.agreementRate).toBe(1.0);
      expect(result.entropyConfidence).toBe(1.0);
      expect(result.composite).toBeGreaterThan(0.9);
    });

    it("includes retry confidence when provided", () => {
      const votes = createUnanimousApprove(3);
      const noRetry = calculateObjectiveConfidence({ votes, retryCount: 0 });
      const withRetry = calculateObjectiveConfidence({ votes, retryCount: 3 });

      expect(noRetry.retryConfidence).toBe(1.0);
      expect(withRetry.retryConfidence).toBeLessThan(0.3);
      expect(withRetry.composite).toBeLessThan(noRetry.composite);
    });

    it("includes metadata with audit trail", () => {
      const votes = createSplitVotes(3, 1);
      const result = calculateObjectiveConfidence({ votes, retryCount: 1 });

      expect(result.metadata.calculatedAt).toBeGreaterThan(0);
      expect(result.metadata.contributingTiers.length).toBeGreaterThan(0);
      expect(result.metadata.formula).toContain("composite");
      expect(result.metadata.signals.length).toBeGreaterThan(0);
    });

    it("uses preset weights", () => {
      const votes = createSplitVotes(4, 1);
      const balanced = calculateObjectiveConfidence(
        { votes, retryCount: 2 },
        { preset: "balanced" },
      );
      const stability = calculateObjectiveConfidence(
        { votes, retryCount: 2 },
        { preset: "stability" },
      );

      // Stability preset weights retry higher, so should have lower composite with retries
      expect(stability.composite).toBeLessThan(balanced.composite);
    });
  });

  describe("quickConfidence", () => {
    it("returns composite without options", () => {
      const votes = createUnanimousApprove(3);
      const confidence = quickConfidence(votes);
      expect(confidence).toBeGreaterThan(0.9);
    });
  });

  describe("meetsThreshold", () => {
    it("returns true when composite meets threshold", () => {
      const result = calculateObjectiveConfidence({
        votes: createUnanimousApprove(3),
      });
      expect(result.composite).toBeGreaterThan(0.95);
      expect(meetsThreshold(result, 0.8)).toBe(true);
      expect(meetsThreshold(result, 0.95)).toBe(true);
    });

    it("returns false when composite below threshold", () => {
      const result = calculateObjectiveConfidence({
        votes: createSplitVotes(2, 2), // 50/50 split
        retryCount: 3,
      });
      expect(meetsThreshold(result, 0.9)).toBe(false);
    });
  });

  describe("getConfidenceTier", () => {
    it("returns correct tier labels", () => {
      expect(getConfidenceTier(0.9)).toBe("high");
      expect(getConfidenceTier(0.6)).toBe("medium");
      expect(getConfidenceTier(0.3)).toBe("low");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Confidence Configuration", () => {
  describe("DEFAULT_WEIGHTS", () => {
    it("sums to 1.0", () => {
      const sum =
        DEFAULT_WEIGHTS.agreementRate +
        DEFAULT_WEIGHTS.entropyConfidence +
        DEFAULT_WEIGHTS.varianceConfidence +
        DEFAULT_WEIGHTS.retryConfidence +
        DEFAULT_WEIGHTS.verificationDepth;
      expect(sum).toBeCloseTo(1.0);
    });
  });

  describe("validateWeights", () => {
    it("accepts valid weights", () => {
      expect(() => validateWeights(DEFAULT_WEIGHTS)).not.toThrow();
    });

    it("rejects invalid weights", () => {
      expect(() =>
        validateWeights({
          ...DEFAULT_WEIGHTS,
          agreementRate: 0.5, // Would make sum > 1
        }),
      ).toThrow();
    });
  });

  describe("normalizeWeights", () => {
    it("normalizes to sum 1.0", () => {
      const normalized = normalizeWeights({
        agreementRate: 3,
        entropyConfidence: 2,
        varianceConfidence: 1,
        retryConfidence: 2,
        verificationDepth: 2,
      });

      const sum = Object.values(normalized).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBeCloseTo(1.0);
      expect(normalized.agreementRate).toBeCloseTo(0.3);
    });
  });

  describe("getPresetWeights", () => {
    it("returns preset weights", () => {
      const consensus = getPresetWeights("consensus");
      expect(consensus.agreementRate).toBeGreaterThan(
        DEFAULT_WEIGHTS.agreementRate,
      );
    });
  });
});
