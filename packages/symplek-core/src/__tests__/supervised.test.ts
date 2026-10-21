/**
 * @module supervised.test
 * @description Tests for the AgentUnit .supervised() operator.
 *   Covers all predicate/decision/timeout/fallback paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SupervisedRejectionError,
  SupervisedTimeoutError,
} from "../AgentUnit/operators/supervised";
import { AgentUnit, createContext } from "../index";
import type { AgentContext } from "../types";

describe("AgentUnit .supervised()", () => {
  const ctx: AgentContext = createContext();

  // Suppress deprecation warnings from legacy trustMode
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
    vi.useRealTimers();
  });

  // ── Story 1: Basic paths ────────────────────────────────────────────────────

  it("predicate returns false → value passes through unchanged", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => false,
      async () => ({ action: "accept" as const }),
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("original");
  });

  it("predicate returns true, reviewer accepts → original value returned", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => true,
      async () => ({ action: "accept" as const }),
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("original");
  });

  it("predicate returns true, reviewer accepts with modified value → modified value returned", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => true,
      async () => ({ action: "accept" as const, value: "modified" }),
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("modified");
  });

  it("predicate returns true, reviewer rejects with fallback → fallback returned", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => true,
      async () => ({
        action: "reject" as const,
        fallback: "reviewer-fallback",
      }),
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("reviewer-fallback");
  });

  it("predicate true, reviewer rejects without fallback, no options.fallbackValue → throws SupervisedRejectionError", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => true,
      async () => ({ action: "reject" as const }),
    );
    await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
      SupervisedRejectionError,
    );
  });

  // ── Story 2: Timeout paths ──────────────────────────────────────────────────

  it("timeout fires, timeoutAction = 'accept' → original value returned", async () => {
    vi.useFakeTimers();

    const reviewFn = vi.fn(
      () =>
        new Promise<{ action: "accept" }>((resolve) => {
          setTimeout(() => resolve({ action: "accept" }), 5_000);
        }),
    );

    const unit = AgentUnit.of("original").supervised(() => true, reviewFn, {
      timeoutMs: 100,
      timeoutAction: "accept",
    });

    const resultPromise = unit.run(ctx, { trustMode: "legacy" });
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;
    expect(result).toBe("original");
  });

  it("timeout fires, timeoutAction = 'reject' → throws SupervisedTimeoutError", async () => {
    vi.useFakeTimers();

    const reviewFn = vi.fn(
      () =>
        new Promise<{ action: "accept" }>((resolve) => {
          setTimeout(() => resolve({ action: "accept" }), 5_000);
        }),
    );

    const unit = AgentUnit.of("original").supervised(() => true, reviewFn, {
      timeoutMs: 100,
      timeoutAction: "reject",
    });

    const resultPromise = unit.run(ctx, { trustMode: "legacy" });
    // Attach the rejection handler BEFORE advancing timers so the rejection is
    // never "unhandled" even momentarily (avoids PromiseRejectionHandledWarning).
    const expectation = expect(resultPromise).rejects.toThrow(
      SupervisedTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(200);
    await expectation;
  });

  // ── Story 3: Fallback from options ──────────────────────────────────────────

  it("predicate true, reviewer rejects without fallback, options.fallbackValue set → fallbackValue returned", async () => {
    const unit = AgentUnit.of("original").supervised(
      () => true,
      async () => ({ action: "reject" as const }),
      { fallbackValue: "options-fallback" },
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("options-fallback");
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  it("operator chain metadata includes 'supervised'", () => {
    const unit = AgentUnit.of("x").supervised(
      () => false,
      async () => ({ action: "accept" as const }),
    );
    const meta = unit.getMetadata();
    expect(meta.operatorChain).toContain("supervised");
  });
});
