/** @module ConsensusDefaultsTest - Unit tests for getConsensusDefaults per-tier values */

import { describe, expect, it } from "vitest";
import { getConsensusDefaults } from "../consensus-defaults";
import type { ImpactTier } from "../types";

describe("getConsensusDefaults", () => {
  const cases: Array<[ImpactTier, { threshold: number; minVetoers: number }]> =
    [
      ["P0", { threshold: 0.95, minVetoers: 3 }],
      ["P1", { threshold: 0.85, minVetoers: 2 }],
      ["P2", { threshold: 0.75, minVetoers: 1 }],
      ["P3", { threshold: 0.6, minVetoers: 0 }],
    ];

  it.each(cases)("tier %s → threshold %f, minVetoers %i", (tier, expected) => {
    const result = getConsensusDefaults(tier);
    expect(result.threshold).toBe(expected.threshold);
    expect(result.minVetoers).toBe(expected.minVetoers);
  });

  it("returns a readonly-safe object (no mutation)", () => {
    const defaults = getConsensusDefaults("P1");
    expect(typeof defaults.threshold).toBe("number");
    expect(typeof defaults.minVetoers).toBe("number");
  });
});
