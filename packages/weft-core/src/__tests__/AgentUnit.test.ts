/**
 * @fileoverview Tests for AgentUnit monad
 * @description Basic tests for weft-core AgentUnit
 *
 * 📝 BUILD[05.04]: Basic tests for AgentUnit
 * 📝 BUILD[01.05]: Updated to use legacy mode after zero-trust default change
 *
 * @remarks
 * These tests use `trustMode: 'legacy'` to test basic operator functionality.
 * For zero-trust specific tests, see zero-trust.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext } from "../index";
import type { AgentContext } from "../types";

describe("AgentUnit", () => {
  const ctx: AgentContext = createContext();

  // Suppress deprecation warnings during tests
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset the deprecation warning flag between tests
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe("Creation", () => {
    it("should create from pure value", async () => {
      const unit = AgentUnit.of(42);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(42);
    });

    it("should create from computation", async () => {
      const unit = AgentUnit.from(async () => {
        return "hello";
      });
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("hello");
    });

    it("should create from Promise", async () => {
      const unit = AgentUnit.fromPromise(Promise.resolve("promise"));
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("promise");
    });

    it("should create failed unit", async () => {
      const unit = AgentUnit.fail(new Error("test error"));
      await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
        "test error",
      );
    });
  });

  describe("Transformation", () => {
    it("should map values", async () => {
      const unit = AgentUnit.of(5).map((x) => x * 2);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(10);
    });

    it("should flatMap computations", async () => {
      const unit = AgentUnit.of(5).flatMap((x) => AgentUnit.of(x * 2));
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(10);
    });

    it("should chain operations", async () => {
      const unit = AgentUnit.of(1)
        .map((x) => x + 1)
        .flatMap((x) => AgentUnit.of(x * 2))
        .map((x) => x + 1);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(5);
    });
  });

  describe("Resilience", () => {
    it("should retry on failure", async () => {
      let attempts = 0;
      const unit = AgentUnit.from(async () => {
        attempts++;
        if (attempts < 2) throw new Error("fail");
        return "success";
      }).retry(3, { baseDelayMs: 10 });

      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should timeout", async () => {
      const unit = AgentUnit.from(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return "done";
      }).timeout(100, "Timeout");

      await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
        "Timeout",
      );
    });

    it("should fallback on failure", async () => {
      const primary = AgentUnit.fail(new Error("fail"));
      const fallback = AgentUnit.of("fallback");
      const unit = primary.fallback(fallback);

      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("fallback");
    });

    it("should use orElse default", async () => {
      const unit = AgentUnit.fail(new Error("fail")).orElse("default");
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("default");
    });
  });

  describe("Source Tracking (explicit .tracked())", () => {
    it("should track source when .tracked() is used", async () => {
      const unit = AgentUnit.of("value").tracked({
        source: "agent",
        confidence: 0.8,
      });

      // .tracked() returns AgentUnit<TrackedResult<T>>
      // With zero-trust, run() wraps in TrackedResult<TrackedResult<T>>
      // We access .value to get the inner TrackedResult
      const result = await unit.run(ctx);
      expect(result.value.value).toBe("value");
      expect(result.value.source).toBe("agent");
      expect(result.value.confidence).toBe(0.8);
    });
  });

  describe("Consensus", () => {
    it("should run single-round consensus", async () => {
      const unit = AgentUnit.of("proposal").consensus(
        [
          () =>
            Promise.resolve({
              decision: "approve" as const,
              confidence: 0.9,
            }),
          () =>
            Promise.resolve({
              decision: "approve" as const,
              confidence: 0.8,
            }),
          () =>
            Promise.resolve({
              decision: "reject" as const,
              confidence: 0.7,
            }),
        ],
        { quorum: 0.5 },
      );

      // .consensus() returns AgentUnit<ConsensusResult>
      // With zero-trust, run() wraps in TrackedResult<ConsensusResult>
      // We access .value to get the ConsensusResult
      const result = await unit.run(ctx);
      expect(result.value.approved).toBe(true);
      expect(result.value.votes).toHaveLength(3);
      expect(result.value.weightedApproval).toBeGreaterThan(0.5);
      // Verify agentId and weight were added
      expect(result.value.votes[0]).toHaveProperty("agentId");
      expect(result.value.votes[0]).toHaveProperty("weight");
    });
  });
});
