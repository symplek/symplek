/**
 * @module __tests__/saga
 * @description Tests for the AgentUnit .saga() operator — multi-step saga pattern
 *   with LIFO rollback and undo error suppression.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SagaStep } from "../AgentUnit/operators/saga";
import { AgentUnit, createContext } from "../index";
import type { AgentContext } from "../types";

describe("AgentUnit.saga()", () => {
  const ctx: AgentContext = createContext();

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("Story 1: happy path — all steps execute in order and results array returned", async () => {
    const step1Execute = vi.fn().mockResolvedValue("result1");
    const step2Execute = vi.fn().mockResolvedValue("result2");
    const step3Execute = vi.fn().mockResolvedValue("result3");

    const steps: SagaStep<string>[] = [
      { execute: step1Execute, undo: vi.fn(), name: "step1" },
      { execute: step2Execute, undo: vi.fn(), name: "step2" },
      { execute: step3Execute, undo: vi.fn(), name: "step3" },
    ];

    const result = await AgentUnit.of(null)
      .saga(steps as SagaStep<unknown>[])
      .run(ctx, { trustMode: "legacy" });

    expect(result).toEqual(["result1", "result2", "result3"]);
    expect(step1Execute).toHaveBeenCalledWith(ctx);
    expect(step2Execute).toHaveBeenCalledWith(ctx);
    expect(step3Execute).toHaveBeenCalledWith(ctx);
  });

  it("Story 2: single step rollback — step 2 fails → step 1 undo called with its result → original error thrown", async () => {
    const step2Error = new Error("step 2 failed");
    const undo1 = vi.fn().mockResolvedValue(undefined);
    const undo2 = vi.fn();

    const steps: SagaStep<unknown>[] = [
      { execute: vi.fn().mockResolvedValue("r1"), undo: undo1, name: "step1" },
      {
        execute: vi.fn().mockRejectedValue(step2Error),
        undo: undo2,
        name: "step2",
      },
    ];

    await expect(
      AgentUnit.of(null).saga(steps).run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("step 2 failed");

    expect(undo1).toHaveBeenCalledTimes(1);
    expect(undo1).toHaveBeenCalledWith(ctx, "r1");
    // Step 2 never succeeded so its undo must NOT be called
    expect(undo2).not.toHaveBeenCalled();
  });

  it("Story 3: 4-step saga — step 3 fails → undoes steps 2 then 1 in LIFO order, step 3 and 4 undo never called", async () => {
    const step3Error = new Error("step 3 failed");
    const undoOrder: number[] = [];

    const undo1 = vi.fn().mockImplementation(async () => {
      undoOrder.push(1);
    });
    const undo2 = vi.fn().mockImplementation(async () => {
      undoOrder.push(2);
    });
    const undo3 = vi.fn();
    const undo4 = vi.fn();

    const steps: SagaStep<unknown>[] = [
      { execute: vi.fn().mockResolvedValue("r1"), undo: undo1, name: "s1" },
      { execute: vi.fn().mockResolvedValue("r2"), undo: undo2, name: "s2" },
      {
        execute: vi.fn().mockRejectedValue(step3Error),
        undo: undo3,
        name: "s3",
      },
      { execute: vi.fn().mockResolvedValue("r4"), undo: undo4, name: "s4" },
    ];

    await expect(
      AgentUnit.of(null).saga(steps).run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("step 3 failed");

    // LIFO: 2 was completed last, so undo 2 runs first
    expect(undoOrder).toEqual([2, 1]);
    expect(undo1).toHaveBeenCalledWith(ctx, "r1");
    expect(undo2).toHaveBeenCalledWith(ctx, "r2");
    // Step 3 never completed; step 4 never ran
    expect(undo3).not.toHaveBeenCalled();
    expect(undo4).not.toHaveBeenCalled();
  });

  it("Story 4: saga step wrapping an AgentUnit with .supervised() — reviewer is invoked during execute", async () => {
    const reviewFn = vi.fn().mockResolvedValue({ action: "accept" });

    const steps: SagaStep<unknown>[] = [
      {
        execute: async (stepCtx) => {
          const value = await AgentUnit.of("supervised-value")
            .supervised(
              () => true, // always trigger review
              reviewFn,
            )
            .run(stepCtx, { trustMode: "legacy" });
          return value;
        },
        undo: vi.fn(),
        name: "supervised-step",
      },
    ];

    const result = await AgentUnit.of(null)
      .saga(steps)
      .run(ctx, { trustMode: "legacy" });

    expect(reviewFn).toHaveBeenCalledTimes(1);
    expect(reviewFn).toHaveBeenCalledWith("supervised-value");
    expect(result).toEqual(["supervised-value"]);
  });

  it("Story 5: undo throws — original step-failure error still propagates (undo errors suppressed)", async () => {
    const step2Error = new Error("step 2 failed");
    const undo1 = vi.fn().mockRejectedValue(new Error("undo 1 exploded"));

    const steps: SagaStep<unknown>[] = [
      { execute: vi.fn().mockResolvedValue("r1"), undo: undo1, name: "s1" },
      {
        execute: vi.fn().mockRejectedValue(step2Error),
        undo: vi.fn(),
        name: "s2",
      },
    ];

    await expect(
      AgentUnit.of(null).saga(steps).run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("step 2 failed");

    // Undo was still called despite throwing
    expect(undo1).toHaveBeenCalledTimes(1);
  });

  it("Story 6 (bonus): all steps succeed — no undo functions are ever called", async () => {
    const undo1 = vi.fn();
    const undo2 = vi.fn();
    const undo3 = vi.fn();

    const steps: SagaStep<unknown>[] = [
      { execute: vi.fn().mockResolvedValue("a"), undo: undo1 },
      { execute: vi.fn().mockResolvedValue("b"), undo: undo2 },
      { execute: vi.fn().mockResolvedValue("c"), undo: undo3 },
    ];

    const result = await AgentUnit.of(null)
      .saga(steps)
      .run(ctx, { trustMode: "legacy" });

    expect(result).toEqual(["a", "b", "c"]);
    expect(undo1).not.toHaveBeenCalled();
    expect(undo2).not.toHaveBeenCalled();
    expect(undo3).not.toHaveBeenCalled();
  });
});
