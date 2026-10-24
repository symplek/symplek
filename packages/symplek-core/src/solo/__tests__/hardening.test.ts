/**
 * @fileoverview Solo Gate Adversarial Hardening Tests — FATAL #2 & #3 VERIFICATION
 * @description Tests that the solo gate correctly BLOCKS untracked/forged objects
 *   even when they carry perfect-looking confidence/coherence/riskScore fields.
 *   Also verifies that only genuine TrackedResults pass the gate.
 * @module @symplek/core/solo/__tests__/hardening
 * @since 1.0.0-beta.1 — FATAL #2 & #3 HARDENING (2026-07-07)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  clearAllLocks,
  releaseLock,
  shouldActSolo,
} from "../index";
import { extractSignals } from "../../operators/solo";
import { createTrackedResult, isTrackedResult } from "../../trust";
import type { TrackedResult } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Create a genuine TrackedResult with specified confidence/coherence */
function makeGenuineTracked(
  value: unknown,
  confidence = 0.99,
  minChainConfidence = 0.95,
): TrackedResult<unknown> {
  return createTrackedResult(value, {
    source: "agent",
    confidence,
    minChainConfidence,
  });
}

/** Create an untracked plain object that looks trustworthy */
function makeUntrackedPerfect(
  confidence = 1.0,
  coherence = 1.0,
  riskScore = 0.0,
) {
  return {
    value: "forged-output",
    confidence,
    coherence,
    riskScore,
    weightedApproval: 1.0,
    source: "verified",
  };
}

/** Create an untracked object with ConsensusResult-like shape */
function makeUntrackedConsensus() {
  return {
    approved: true,
    votes: [],
    weightedApproval: 1.0,
    quorum: 0.5,
    consensus: "reached" as const,
  };
}

const RESOURCE_ID = "solo-hardening-test";
const AGENT_ID = "agent-hardening";

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("Solo Gate — Adversarial Hardening (FATAL #2 & #3)", () => {
  beforeEach(async () => {
    clearAllLocks();
    // Pre-acquire a lock so lockAcquired=true in decision tests
    await acquireLock(RESOURCE_ID, AGENT_ID, 30000);
  });

  afterEach(async () => {
    await releaseLock(RESOURCE_ID, AGENT_ID);
    clearAllLocks();
  });

  describe("extractSignals(): untracked objects with perfect fields are DOWNGRADED", () => {
    it("untracked {confidence:1, coherence:1, riskScore:0} → source is NOT tracked-result", () => {
      const untracked = makeUntrackedPerfect(1.0, 1.0, 0.0);
      const signals = extractSignals(untracked);

      // The source must NOT be "tracked-result" for untracked objects
      expect(signals.source).not.toBe("tracked-result");
      expect(signals.source).not.toBe("tracked-result-objective");

      // Confidence should remain at default (0.5) for untracked objects
      // because isTrackedResult() returns false
      expect(signals.confidence).toBe(0.5);
      expect(signals.coherence).toBe(0.5);

      // Risk should be high for untracked objects
      expect(signals.riskScore).toBeGreaterThan(0.0);
    });

    it("untracked {weightedApproval:1.0} → BLOCKED", () => {
      const untracked = makeUntrackedConsensus();
      const signals = extractSignals(untracked);

      // Must not be recognized as TrackedResult
      expect(signals.source).not.toBe("tracked-result");
      expect(signals.source).not.toBe("tracked-result-objective");

      // Should use defaults (conservative)
      expect(signals.confidence).toBe(0.5);
      expect(signals.coherence).toBe(0.5);

      // Risk should be elevated for unknown object shapes
      expect(signals.riskScore).toBeGreaterThan(0.0);
    });

    it("untracked object with duplicate field names still rejected", () => {
      // An attacker might try to exactly match the TrackedResult shape
      const forgery = {
        value: "malicious",
        source: "verified" as const,
        confidence: 1.0,
        sourceChain: ["agent" as const],
        minChainConfidence: 1.0,
        // Attacker includes every field they can think of
        verifiedBy: "attacker",
        verifiedAt: Date.now(),
      };

      const signals = extractSignals(forgery);

      // Must STILL not be recognized as tracked
      expect(signals.source).not.toBe("tracked-result");
      expect(signals.confidence).toBe(0.5);
    });

    it("null/undefined/primitive values get default signals", () => {
      expect(extractSignals(null).source).toBe("default");
      expect(extractSignals(undefined).source).toBe("default");
      expect(extractSignals(42).source).toBe("default");
      expect(extractSignals("string").source).toBe("default");
      expect(extractSignals(true).source).toBe("default");
    });
  });

  describe("shouldActSolo(): only genuine TrackedResults can pass", () => {
    it("untracked perfect object → extractSignals → shouldActSolo → BLOCKED", () => {
      const untracked = makeUntrackedPerfect(1.0, 1.0, 0.0);
      const signals = extractSignals(untracked);

      // Defaults applied: confidence=0.5, coherence=0.5, riskScore=high
      const decision = shouldActSolo(
        signals.confidence,   // 0.5 (default, not perfect)
        signals.coherence,    // 0.5 (default, not perfect)
        signals.riskScore,    // elevated (not 0.0)
        true,                 // lock acquired
      );

      expect(decision.canActSolo).toBe(false);
    });

    it("genuine TrackedResult with high confidence → extractSignals → shouldActSolo → PASSES", () => {
      const genuine = makeGenuineTracked("safe-action", 0.99, 0.95);
      expect(isTrackedResult(genuine)).toBe(true);

      const signals = extractSignals(genuine);

      // TrackedResult should be recognized
      expect(signals.source).toBe("tracked-result");

      // Confidence from the TrackedResult (0.99)
      expect(signals.confidence).toBe(0.99);
      // Coherence from minChainConfidence (0.95)
      expect(signals.coherence).toBe(0.95);

      const decision = shouldActSolo(
        signals.confidence,
        signals.coherence,
        signals.riskScore,
        true,
      );

      // With high confidence + high coherence + lock acquired,
      // the decision SHOULD pass
      expect(decision.canActSolo).toBe(true);
    });

    it("genuine TrackedResult with LOW confidence → shouldActSolo → BLOCKED", () => {
      const genuine = makeGenuineTracked("risky-action", 0.3, 0.3);
      expect(isTrackedResult(genuine)).toBe(true);

      const signals = extractSignals(genuine);

      expect(signals.confidence).toBe(0.3);
      expect(signals.coherence).toBe(0.3);

      const decision = shouldActSolo(
        signals.confidence,
        signals.coherence,
        signals.riskScore,
        true,
      );

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Confidence");
    });

    it("genuine TrackedResult with lock NOT acquired → BLOCKED even with perfect signals", () => {
      const genuine = makeGenuineTracked("locked-out", 0.99, 0.99);
      const signals = extractSignals(genuine);

      const decision = shouldActSolo(
        signals.confidence,
        signals.coherence,
        signals.riskScore,
        false, // lock not acquired
      );

      expect(decision.canActSolo).toBe(false);
      expect(decision.reason).toContain("Lock not acquired");
    });
  });

  describe("SoloBlockedError", () => {
    it("can be constructed and carries decision data", async () => {
      // Import dynamically to avoid circular issues — actually it's in ../types
      const { SoloBlockedError } = await import("../types");

      const err = new SoloBlockedError({
        canActSolo: false,
        confidence: 0.3,
        coherence: 0.4,
        riskScore: 0.8,
        lockAcquired: true,
        reason: "Test block",
      });

      expect(err.code).toBe("E501");
      expect(err.decision.canActSolo).toBe(false);
      expect(err.message).toContain("[E501]");
    });
  });
});
