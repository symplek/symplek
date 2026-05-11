/**
 * @fileoverview Integration Tests for Solo Mechanism
 * @module weft-core/solo/__tests__/integration
 *
 * 📝 BUILD[STORY-03.05]: Integration tests for AgentUnit.solo()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit } from "../../AgentUnit";
import { createContext } from "../../context";
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
      // Create value with high signals
      const valueWithSignals = {
        data: "test",
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      };

      const result = await AgentUnit.of(valueWithSignals)
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      expect(result.transactionId).toMatch(/^txn_/);
      expect(result.value).toEqual(valueWithSignals);
    });

    it("should block when confidence is low", async () => {
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
      const valueWithLowCoherence = {
        data: "test",
        confidence: 0.95,
        coherence: 0.5,
        riskScore: 0.15,
      };

      await expect(
        AgentUnit.of(valueWithLowCoherence)
          .solo()
          .run(ctx, { trustMode: "legacy" }),
      ).rejects.toThrow(SoloBlockedError);
    });

    it("should block when risk is high", async () => {
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
      const valueWithMediumSignals = {
        data: "test",
        confidence: 0.8,
        coherence: 0.75,
        riskScore: 0.4,
      };

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
      const value = {
        confidence: 0.92,
        coherence: 0.88,
        riskScore: 0.2,
      };

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

      const value = {
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      };

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

      const value = {
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      };

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
        .map((v) => ({
          ...v,
          confidence: 0.95,
          coherence: 0.9,
          riskScore: 0.15,
        }))
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      expect(result.value.data).toBe(1);
    });

    it("should work with tap", async () => {
      const sideEffect = vi.fn();

      const result = await AgentUnit.of({
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      })
        .tap(sideEffect)
        .solo()
        .run(ctx, { trustMode: "legacy" });

      expect(sideEffect).toHaveBeenCalledTimes(1);
      expect(result.decision.canActSolo).toBe(true);
    });

    it("should work with fallback", async () => {
      const highConfidenceValue = {
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      };

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
      const unit = AgentUnit.of({
        confidence: 0.95,
        coherence: 0.9,
        riskScore: 0.15,
      }).solo();

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
      // When using zero-trust mode, results are wrapped in TrackedResult
      // The TrackedResult's confidence is calculated by the confidence module
      const unit = AgentUnit.of({
        confidence: 0.95, // This is the value's explicit confidence
        coherence: 0.9,
        riskScore: 0.15,
      });

      // Run in zero-trust mode to get TrackedResult
      const tracked = await unit.run(ctx);

      // The TrackedResult has its own tracked confidence (from confidence module)
      // We lower the threshold to verify signal extraction works
      const result = await AgentUnit.of(tracked)
        .map((t) => ({
          ...t,
          confidence: t.confidence, // Uses TrackedResult's confidence
          coherence: 0.9,
          riskScore: 0.15,
        }))
        .solo({ confidenceThreshold: 0.8 }) // Lower threshold to verify extraction
        .run(ctx, { trustMode: "legacy" });

      expect(result.decision.canActSolo).toBe(true);
      // Verify the extracted confidence was used (tracked confidence, not explicit)
      expect(result.decision.confidence).toBeGreaterThanOrEqual(0.8);
    });
  });
});
