/**
 * @fileoverview Tests for Solo Decision Algorithm
 * @module @symplek/core/solo/__tests__/decision
 *
 * 📝 BUILD[STORY-03.01]: Decision algorithm tests
 */

import { describe, expect, it } from "vitest";
import { SOLO_DEFAULTS } from "../config";
import {
  calculateMargins,
  decisionFromSignals,
  formatDecision,
  meetsThresholds,
  shouldActSolo,
} from "../decision";

describe("shouldActSolo", () => {
  describe("approval conditions", () => {
    it("should approve when all thresholds are met", () => {
      const decision = shouldActSolo(0.95, 0.9, 0.15, true);

      expect(decision.canActSolo).toBe(true);
      expect(decision.confidence).toBe(0.95);
      expect(decision.coherence).toBe(0.9);
      expect(decision.riskScore).toBe(0.15);
      expect(decision.lockAcquired).toBe(true);
      expect(decision.reason).toBeUndefined();
    });

    it("should approve at exact threshold values", () => {
      const decision = shouldActSolo(
        SOLO_DEFAULTS.confidenceThreshold,
        SOLO_DEFAULTS.coherenceThreshold,
        SOLO_DEFAULTS.riskThreshold,
        true,
      );

      expect(decision.canActSolo).toBe(true);
    });

    it("should include timestamp in decision", () => {
      const before = Date.now();
      const decision = shouldActSolo(0.95, 0.9, 0.15, true);
      const after = Date.now();

      expect(decision.timestamp).toBeGreaterThanOrEqual(before);
      expect(decision.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("rejection conditions", () => {
    it("should reject when lock not acquired (highest priority)", () => {
      const decision = shouldActSolo(0.95, 0.9, 0.15, false);

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Lock not acquired");
    });

    it("should reject when confidence below threshold", () => {
      const decision = shouldActSolo(0.8, 0.9, 0.15, true);

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Confidence");
      expect(decision.reason).toContain("80.0%");
    });

    it("should reject when coherence below threshold", () => {
      const decision = shouldActSolo(0.95, 0.7, 0.15, true);

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Coherence");
      expect(decision.reason).toContain("70.0%");
    });

    it("should reject when risk score above threshold", () => {
      const decision = shouldActSolo(0.95, 0.9, 0.5, true);

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Risk");
      expect(decision.reason).toContain("50.0%");
    });

    it("should report lock failure even if other conditions fail", () => {
      // Lock is checked first
      const decision = shouldActSolo(0.5, 0.5, 0.8, false);

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Lock not acquired");
    });
  });

  describe("custom thresholds", () => {
    it("should use custom confidence threshold", () => {
      const decision = shouldActSolo(0.85, 0.9, 0.15, true, {
        confidenceThreshold: 0.8,
      });

      expect(decision.canActSolo).toBe(true);
    });

    it("should use custom coherence threshold", () => {
      const decision = shouldActSolo(0.95, 0.75, 0.15, true, {
        coherenceThreshold: 0.7,
      });

      expect(decision.canActSolo).toBe(true);
    });

    it("should use custom risk threshold", () => {
      const decision = shouldActSolo(0.95, 0.9, 0.45, true, {
        riskThreshold: 0.5,
      });

      expect(decision.canActSolo).toBe(true);
    });

    it("should reject with custom stricter thresholds", () => {
      const decision = shouldActSolo(0.92, 0.9, 0.15, true, {
        confidenceThreshold: 0.95,
      });

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("92.0%");
      expect(decision.reason).toContain("95.0%");
    });
  });
});

describe("decisionFromSignals", () => {
  it("should create decision from extracted signals", () => {
    const signals = {
      confidence: 0.92,
      coherence: 0.88,
      riskScore: 0.2,
    };

    const decision = decisionFromSignals(signals, true);

    expect(decision.canActSolo).toBe(true);
    expect(decision.confidence).toBe(0.92);
    expect(decision.coherence).toBe(0.88);
    expect(decision.riskScore).toBe(0.2);
  });
});

describe("meetsThresholds", () => {
  it("should return true when all thresholds met", () => {
    const result = meetsThresholds(0.95, 0.9, 0.15);
    expect(result).toBe(true);
  });

  it("should return false when any threshold not met", () => {
    expect(meetsThresholds(0.8, 0.9, 0.15)).toBe(false); // confidence
    expect(meetsThresholds(0.95, 0.7, 0.15)).toBe(false); // coherence
    expect(meetsThresholds(0.95, 0.9, 0.5)).toBe(false); // risk
  });

  it("should ignore lock status (for pre-flight)", () => {
    // meetsThresholds doesn't consider lock
    const result = meetsThresholds(0.95, 0.9, 0.15);
    expect(result).toBe(true);
  });
});

describe("calculateMargins", () => {
  it("should calculate positive margins when exceeding thresholds", () => {
    const decision = shouldActSolo(0.95, 0.9, 0.15, true);
    const margins = calculateMargins(decision);

    expect(margins.confidenceMargin).toBeGreaterThan(0);
    expect(margins.coherenceMargin).toBeGreaterThan(0);
    expect(margins.riskMargin).toBeGreaterThan(0);
  });

  it("should calculate negative margins when below thresholds", () => {
    const decision = shouldActSolo(0.8, 0.7, 0.5, true);
    const margins = calculateMargins(decision);

    expect(margins.confidenceMargin).toBeLessThan(0);
    expect(margins.coherenceMargin).toBeLessThan(0);
    expect(margins.riskMargin).toBeLessThan(0);
  });

  it("should calculate zero margins at exact thresholds", () => {
    const decision = shouldActSolo(
      SOLO_DEFAULTS.confidenceThreshold,
      SOLO_DEFAULTS.coherenceThreshold,
      SOLO_DEFAULTS.riskThreshold,
      true,
    );
    const margins = calculateMargins(decision);

    expect(margins.confidenceMargin).toBe(0);
    expect(margins.coherenceMargin).toBe(0);
    expect(margins.riskMargin).toBe(0);
  });
});

describe("formatDecision", () => {
  it("should format approved decision", () => {
    const decision = shouldActSolo(0.95, 0.9, 0.15, true);
    const formatted = formatDecision(decision);

    expect(formatted).toContain("✅ APPROVED");
    expect(formatted).toContain("95.0%");
    expect(formatted).toContain("90.0%");
    expect(formatted).toContain("15.0%");
    expect(formatted).toContain("Acquired");
  });

  it("should format blocked decision with reason", () => {
    const decision = shouldActSolo(0.8, 0.9, 0.15, true);
    const formatted = formatDecision(decision);

    expect(formatted).toContain("❌ BLOCKED");
    expect(formatted).toContain("Reason:");
  });
});
