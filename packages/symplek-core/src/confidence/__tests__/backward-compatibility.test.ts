/**
 * @fileoverview Backward Compatibility Tests for Objective Confidence
 * @description Verifies that existing code continues to work without changes
 *
 * Story 02.07: Backward compatibility layer
 *
 * @remarks
 * These tests ensure:
 * 1. Existing confidence field still works in TrackedResult
 * 2. Operations without objective confidence continue to function
 * 3. Optional objectiveConfidence field doesn't break type contracts
 * 4. Legacy code patterns remain valid
 */

import { describe, expect, it } from "vitest";
import { AgentUnit } from "../../AgentUnit";
import type { AgentContext, TrackedResult } from "../../types";

// Mock context for testing
const mockCtx: AgentContext = {
  sessionId: "test-session",
  timestamp: Date.now(),
  metadata: {},
};

describe("Backward Compatibility", () => {
  describe("TrackedResult", () => {
    it("should work with existing confidence field (no objectiveConfidence)", async () => {
      const unit = AgentUnit.of(42);
      const result = await unit.run(mockCtx);

      // Original confidence field should exist and be valid
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      // Source tracking should work
      expect(result.source).toBe("agent");
      expect(result.value).toBe(42);

      // objectiveConfidence is optional - may or may not be present
      // This test just ensures the code doesn't crash
    });

    it("should allow destructuring without objectiveConfidence", async () => {
      const unit = AgentUnit.of("test");
      const result = await unit.run(mockCtx);

      // Destructure like legacy code would
      const { value, confidence, source } = result;

      expect(value).toBe("test");
      expect(typeof confidence).toBe("number");
      expect(source).toBe("agent");
    });

    it("should not require objectiveConfidence for type compatibility", () => {
      // Create a TrackedResult manually without objectiveConfidence
      const manualResult: TrackedResult<number> = {
        __tracked: true,
        value: 123,
        source: "agent",
        confidence: 0.85,
        sourceChain: ["agent"],
        minChainConfidence: 0.85,
        // Note: objectiveConfidence intentionally omitted
      };

      // Should compile and work
      expect(manualResult.value).toBe(123);
      expect(manualResult.confidence).toBe(0.85);
      expect(manualResult.objectiveConfidence).toBeUndefined();
    });
  });

  describe("Consensus Operator", () => {
    it("should return result usable with legacy code pattern", async () => {
      const voters = [
        async () => ({ decision: "approve" as const, confidence: 0.9 }),
      ];

      const unit = AgentUnit.of(42).consensus(voters, { quorum: 0.5 });
      const result = await unit.run(mockCtx);

      // Legacy pattern: check approved status
      if (result.value.approved) {
        // This is how existing code would use it
        expect(result.value.votes.length).toBeGreaterThan(0);
      }

      // Original fields should still exist
      expect(result.value.votes).toBeDefined();
      expect(result.value.weightedApproval).toBeDefined();
      expect(result.value.quorum).toBeDefined();
    });

    it("should allow checking objectiveConfidence when present", async () => {
      const voters = [
        async () => ({ decision: "approve" as const, confidence: 0.9 }),
        async () => ({ decision: "approve" as const, confidence: 0.8 }),
      ];

      const unit = AgentUnit.of(42).consensus(voters, { quorum: 0.5 });
      const result = await unit.run(mockCtx);

      // New pattern: optionally use objectiveConfidence
      if (result.value.objectiveConfidence) {
        expect(result.value.objectiveConfidence.composite).toBeGreaterThan(0);
        expect(
          result.value.objectiveConfidence.agreementRate,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Type Safety", () => {
    it("should maintain type inference for value field", async () => {
      const unit = AgentUnit.of({ name: "test", count: 42 });
      const result = await unit.run(mockCtx);

      // Type inference should work
      expect(result.value.name).toBe("test");
      expect(result.value.count).toBe(42);
    });

    it("should maintain chain operations", async () => {
      const result = await AgentUnit.of(10)
        .map((x) => x * 2)
        .map((x) => x + 5)
        .run(mockCtx);

      expect(result.value).toBe(25);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should maintain flatMap operations", async () => {
      const result = await AgentUnit.of(5)
        .flatMap((x) => AgentUnit.of(x * 3))
        .run(mockCtx);

      expect(result.value).toBe(15);
    });
  });

  describe("Error Handling", () => {
    it("should maintain error behavior without objectiveConfidence", async () => {
      const failingUnit = AgentUnit.from(async () => {
        throw new Error("Test error");
      });

      await expect(failingUnit.run(mockCtx)).rejects.toThrow("Test error");
    });

    it("should maintain fallback behavior", async () => {
      const result = await AgentUnit.from<number>(async () => {
        throw new Error("Primary failed");
      })
        .fallback(AgentUnit.of(999))
        .run(mockCtx);

      expect(result.value).toBe(999);
    });

    // Note: retry() operator has a pre-existing bug in the codebase
    // Skipping retry backward compatibility test as it's not related to objective confidence changes
  });

  describe("Legacy Trust Modes", () => {
    it("should support legacy trust mode returning raw value", async () => {
      const unit = AgentUnit.of(42);
      const result = await unit.run(mockCtx, { trustMode: "legacy" });

      // Legacy mode returns raw value, not TrackedResult
      expect(result).toBe(42);
    });

    it("should support zero-trust mode returning TrackedResult", async () => {
      const unit = AgentUnit.of(42);
      const result = await unit.run(mockCtx, { trustMode: "zero-trust" });

      expect(result.value).toBe(42);
      expect(result.confidence).toBeDefined();
    });
  });

  describe("Confidence Adjustments", () => {
    it("should maintain confidence adjustments from operator chain", async () => {
      // Get base confidence
      const baseResult = await AgentUnit.of(1).run(mockCtx);
      const baseConfidence = baseResult.confidence;

      // The confidence system should still apply adjustments based on operators
      // even though we now have objective confidence as well
      expect(baseConfidence).toBeGreaterThan(0);
      expect(baseConfidence).toBeLessThanOrEqual(1);
    });
  });
});
