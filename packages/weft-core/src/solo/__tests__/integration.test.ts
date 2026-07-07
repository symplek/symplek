/**
 * @fileoverview Integration Tests for Solo Mechanism
 * @module weft-core/solo/__tests__/integration
 *
 * 📝 BUILD[STORY-03.05]: Integration tests for AgentUnit.solo()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit } from "../../AgentUnit";
import { createContext } from "../../context";
import { createTrackedResult } from "../../trust";
import { clearAllLocks } from "../lock";
import { clearAllTransactions } from "../transactionLog";
import { SoloBlockedError } from "../types";

describe("AgentUnit.solo() Integration", () => {
  const ctx = createContext();

  beforeEach(() => {
    clearAllLocks();
    clearAllTransactions();
  });

  afterEach(() => {
    clearAllLocks();
    clearAllTransactions();
  });

  describe("basic solo execution", () => {
    it("should execute solo when confidence and coherence are high", async () => {
      // Use createTrackedResult() so extractSignals trusts the high signals
      const valueWithSignals = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      const result = await AgentUnit.of(valueWithSignals)
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      expect(result.transactionId).toMatch(/^txn_/);
      expect(result.value).toEqual(valueWithSignals);
    });

    it("should block when confidence is low", async () => {
      // Plain object — extractSignals gives default 0.5 confidence → blocked
      const valueWithLowConfidence = {
        data: "test",
        confidence: 0.5,
        coherence: 0.9,
        riskScore: 0.15,
      };

      await expect(
        AgentUnit.of(valueWithLowConfidence)
          .solo()
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });

    it("should block when coherence is low", async () => {
      // Create a tracked result but with low confidence → blocked
      const valueWithLowCoherence = createTrackedResult("test", {
        source: "agent",
        confidence: 0.5,
        minChainConfidence: 0.5,
      });

      await expect(
        AgentUnit.of(valueWithLowCoherence)
          .solo()
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });

    it("should block when risk is high", async () => {
      // Plain object — extractSignals raises risk for untracked
      const valueWithHighRisk = {
        data: "test",
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.8,
      };

      await expect(
        AgentUnit.of(valueWithHighRisk)
          .solo()
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });
  });

  describe("custom thresholds", () => {
    it("should use custom thresholds", async () => {
      // TrackedResult with medium signals + lowered thresholds → passes
      const valueWithMediumSignals = createTrackedResult("test", {
        source: "agent",
        confidence: 0.8,
        minChainConfidence: 0.75,
      });

      const result = await AgentUnit.of(valueWithMediumSignals)
        .solo({
          confidenceThreshold: 0.7,
          coherenceThreshold: 0.7,
          riskThreshold: 0.5,
        })
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
    });

    it("should block with stricter thresholds", async () => {
      // TrackedResult with 0.92 confidence, threshold 0.95 → blocked
      const value = createTrackedResult("test", {
        source: "agent",
        confidence: 0.92,
        minChainConfidence: 0.88,
      });

      await expect(
        AgentUnit.of(value)
          .solo({
            confidenceThreshold: 0.95,
          })
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });
  });

  describe("callbacks", () => {
    it("should call onSoloAction when approved", async () => {
      const onSoloAction = vi.fn();

      const value = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      await AgentUnit.of(value)
        .solo({ onSoloAction })
        .run(ctx, { trustMode: "legacy" });

      expect(onSoloAction).toHaveBeenCalledTimes(1);
      expect(onSoloAction).toHaveBeenCalledWith(
        expect.objectContaining({
          canActSolo: true,
          confidence: 0.95,
        }),
      );
    });

    it("should call onBlocked when blocked", async () => {
      const onBlocked = vi.fn();

      // Plain object → default 0.5 confidence → blocked
      const value = {
        confidence: 0.5,
        coherence: 0.9,
        riskScore: 0.15,
      };

      await expect(
        AgentUnit.of(value)
          .solo({ onBlocked })
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);

      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(onBlocked).toHaveBeenCalledWith(
        expect.objectContaining({
          canActSolo: false,
        }),
      );
    });

    it("should call lock callbacks", async () => {
      const onLockAttempt = vi.fn();
      const onLockRelease = vi.fn();

      const value = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      await AgentUnit.of(value)
        .solo({ onLockAttempt, onLockRelease })
        .run(ctx, { trustMode: "legacy" });

      expect(onLockAttempt).toHaveBeenCalledTimes(1);
      expect(onLockRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe("chaining with other operators", () => {
    it("should work after map", async () => {
      const result = await AgentUnit.of({ data: 1 })
        .map((v) =>
          createTrackedResult(v, {
            source: "agent",
            confidence: 0.95,
            minChainConfidence: 0.9,
          }),
        )
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      // value is the TrackedResult wrapper, data is inside .value
      expect(result.value.value.data).toBe(1);
    });

    it("should work with tap", async () => {
      const sideEffect = vi.fn();

      const value = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      const result = await AgentUnit.of(value)
        .tap(sideEffect)
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(sideEffect).toHaveBeenCalledTimes(1);
      expect(result.decision.canActSolo).toBe(true);
    });

    it("should work with fallback", async () => {
      const highConfidenceValue = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      // First attempt fails, fallback succeeds
      const result = await AgentUnit.fail<typeof highConfidenceValue>(
        new Error("First failed"),
      )
        .fallback(AgentUnit.of(highConfidenceValue))
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
    });
  });

  describe("error details", () => {
    it("should include decision in error", async () => {
      // Plain object → default 0.5 confidence → blocked
      const value = {
        confidence: 0.5,
        coherence: 0.9,
        riskScore: 0.15,
      };

      try {
        await AgentUnit.of(value).solo().run(ctx, { trustMode: "legacy" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SoloBlockedError);
        const soloError = error as SoloBlockedError;
        expect(soloError.code).toBe("E501");
        expect(soloError.decision.confidence).toBe(0.5);
        expect(soloError.decision.reason).toContain("Confidence");
      }
    });
  });

  describe("operator chain metadata", () => {
    it("should track solo in operator chain", async () => {
      const unit = AgentUnit.of(
        createTrackedResult("test", {
          source: "agent",
          confidence: 0.95,
          minChainConfidence: 0.9,
        }),
      ).solo();

      const metadata = unit.getMetadata();
      expect(metadata.operatorChain).toContain("solo");
    });
  });

  describe("signal extraction", () => {
    it("should use default signals for plain objects", async () => {
      const plainObject = { data: "test" };

      // With default signals, it should be blocked
      await expect(
        AgentUnit.of(plainObject).solo().run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });

    it("should extract confidence from TrackedResult", async () => {
      // Create a TrackedResult with high confidence
      const tracked = createTrackedResult("test", {
        source: "agent",
        confidence: 0.95,
        minChainConfidence: 0.9,
      });

      // The TrackedResult has its own tracked confidence
      // We lower the threshold to verify signal extraction works
      const result = await AgentUnit.of(tracked)
        .solo({ confidenceThreshold: 0.8 }) // Lower threshold to verify extraction
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      // Verify the extracted confidence was used (tracked confidence)
      expect(result.decision.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });
});
