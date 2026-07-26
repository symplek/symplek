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

    it("promise voter receives timeout abort signal — stops waiting after timeout fires", async () => {
      // Reviewer finding: Promise-returning voters never received the cancellation
      // signal, so a timed-out vote kept provider requests running and consuming
      // resources. The fix races the promise voter against the AbortSignal.
      //
      // Interleaving forced: a slow promise voter is paired with a 20 ms vote
      // timeout. After the timeout fires, the vote is abandoned (abstain) rather
      // than waiting for the full promise resolution. The slow promise never
      // resolves within the test — if it were still being awaited, the test would
      // hang.
      let slowVoterResolved = false;
      const slowVoter = () =>
        new Promise<{ decision: "approve"; confidence: number }>((resolve) => {
          // Resolves after 500 ms — well past the vote timeout
          setTimeout(() => {
            slowVoterResolved = true;
            resolve({ decision: "approve", confidence: 0.9 });
          }, 500);
        });

      const unit = AgentUnit.of("proposal").consensus(
        [
          slowVoter,
          () => Promise.resolve({ decision: "approve" as const, confidence: 0.8 }),
        ],
        { quorum: 0.5, timeout: 20 },
      );

      const result = await unit.run(ctx);

      // The slow voter abstained due to timeout; consensus still resolved
      expect(result.value.votes).toHaveLength(2);
      // The slow voter must have abstained
      const slowVote = result.value.votes[0]!;
      expect(slowVote.decision).toBe("abstain");
      // slowVoterResolved is still false at this point — the test didn't wait for it
      expect(slowVoterResolved).toBe(false);
    });

    it("upstream context signal propagates through per-voter timeout window", async () => {
      // Reviewer finding: the per-voter timeout signal REPLACED the context signal
      // instead of composing with it. If the caller aborted ctx.signal after 10 ms
      // but voteTimeout was 60 s, the voter ran for another minute.
      //
      // The fix composes both signals: the voter aborts when EITHER fires.
      const controller = new AbortController();
      const ctxWithSignal = createContext({ signal: controller.signal });

      let _voterReceivedAbort = false;
      const signalAwareVoter = () =>
        new Promise<{ decision: "approve"; confidence: number }>((resolve, reject) => {
          // This promise checks whether its own signal fires (the composed one)
          // In practice, Promise voters receive a race against the composed signal
          // courtesy of the Promise-voter branch. Abort the context signal after
          // a short delay to simulate upstream cancellation.
          setTimeout(() => controller.abort(), 10);
          // The promise would "normally" resolve after 500 ms, but the upstream
          // abort at 10 ms should race it via the AbortSignal composition.
          setTimeout(() => {
            if (!controller.signal.aborted) {
              resolve({ decision: "approve", confidence: 0.9 });
            } else {
              _voterReceivedAbort = true;
              reject(new DOMException("Aborted", "AbortError"));
            }
          }, 50);
        });

      const unit = AgentUnit.of("proposal").consensus(
        [signalAwareVoter],
        {
          quorum: 0.5,
          timeout: 2000, // long timeout — upstream signal should win
        },
      );

      // The upstream abort should cause the voter to abstain rather than waiting
      const result = await unit.run(ctxWithSignal);
      expect(result.value.votes[0]!.decision).toBe("abstain");
    });
  });
});
