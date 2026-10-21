/**
 * @fileoverview Performance benchmarks for objective confidence calculations
 * @module packages/symplek-core/src/confidence/__tests__/confidence.bench
 *
 * Run with: npx vitest bench packages/symplek-core/src/confidence/__tests__/confidence.bench.ts
 *
 * Target performance:
 * - 5 responses: < 0.1ms
 * - 50 responses: < 1ms
 * - 500 responses: < 10ms
 */

import { bench, describe } from "vitest";
import { calculateObjectiveConfidence, WEIGHT_PRESETS } from "../index";
import type { Vote } from "../types";

// Generate test data
function generateVotes(count: number): Vote[] {
  const options = ["approve", "reject", "abstain"];
  return Array.from({ length: count }, (_, i) => ({
    agentId: `agent-${i}`,
    option: options[i % options.length],
    weight: 1,
  }));
}

function generatePredictions(count: number): number[] {
  return Array.from({ length: count }, () => Math.random());
}

describe("Confidence Calculation Performance", () => {
  // Small data sets (typical usage)
  const small = {
    votes: generateVotes(5),
    predictions: generatePredictions(5),
    retryCount: 0,
  };

  // Medium data sets (complex consensus)
  const medium = {
    votes: generateVotes(50),
    predictions: generatePredictions(50),
    retryCount: 2,
  };

  // Large data sets (stress test)
  const large = {
    votes: generateVotes(500),
    predictions: generatePredictions(500),
    retryCount: 5,
  };

  describe("Default Weights", () => {
    bench("5 responses (typical)", () => {
      calculateObjectiveConfidence(small);
    });

    bench("50 responses (complex)", () => {
      calculateObjectiveConfidence(medium);
    });

    bench("500 responses (stress)", () => {
      calculateObjectiveConfidence(large);
    });
  });

  describe("With Preset Lookup", () => {
    bench("5 responses + consensus preset", () => {
      calculateObjectiveConfidence(small, WEIGHT_PRESETS.consensus);
    });

    bench("50 responses + gantt preset", () => {
      calculateObjectiveConfidence(medium, WEIGHT_PRESETS.gantt);
    });

    bench("500 responses + highStakes preset", () => {
      calculateObjectiveConfidence(large, WEIGHT_PRESETS.highStakes);
    });
  });

  describe("Individual Components", () => {
    bench("Votes only (5)", () => {
      calculateObjectiveConfidence({ votes: small.votes });
    });

    bench("Predictions only (50)", () => {
      calculateObjectiveConfidence({ predictions: medium.predictions });
    });

    bench("All inputs (50)", () => {
      calculateObjectiveConfidence({
        votes: medium.votes,
        predictions: medium.predictions,
        retryCount: medium.retryCount,
        verificationLevel: 0.8,
      });
    });
  });

  describe("Edge Cases", () => {
    bench("Empty input", () => {
      calculateObjectiveConfidence({});
    });

    bench("Single vote", () => {
      calculateObjectiveConfidence({ votes: [{ agentId: "a", option: "x" }] });
    });

    bench("Unanimous votes (50)", () => {
      const unanimous = Array.from({ length: 50 }, (_, i) => ({
        agentId: `agent-${i}`,
        option: "approve",
      }));
      calculateObjectiveConfidence({ votes: unanimous });
    });

    bench("All different votes (50)", () => {
      const diverse = Array.from({ length: 50 }, (_, i) => ({
        agentId: `agent-${i}`,
        option: `option-${i}`,
      }));
      calculateObjectiveConfidence({ votes: diverse });
    });
  });
});
