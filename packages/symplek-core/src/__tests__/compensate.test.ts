/**
 * @module __tests__/compensate
 * @description Tests for the AgentUnit .compensate() operator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompensateFn } from "../AgentUnit/operators/compensate";
import { AgentUnit, CompensationError, createContext } from "../index";
import type { AgentContext } from "../types";

describe("AgentUnit.compensate()", () => {
  const ctx: AgentContext = createContext();

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit.resetDeprecationWarningForTesting();
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("Story 1: success path — compensation is never called", async () => {
    const compensateFn = vi.fn<CompensateFn>();
    const result = await AgentUnit.of("ok")
      .compensate(compensateFn)
      .run(ctx, { trustMode: "legacy" });

    expect(result).toBe("ok");
    expect(compensateFn).not.toHaveBeenCalled();
  });

  it("Story 2: failure path — compensation called once and original error re-thrown", async () => {
    const primaryError = new Error("primary failed");
    const compensateFn = vi.fn<CompensateFn>();

    await expect(
      AgentUnit.fail<string>(primaryError)
        .compensate(compensateFn)
        .run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("primary failed");

    expect(compensateFn).toHaveBeenCalledTimes(1);
    expect(compensateFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: primaryError, agentContext: ctx }),
    );
  });

  it("Story 3: compensation receives error context with correct Error instance and message", async () => {
    const primaryError = new Error("detailed failure message");
    let capturedContext: Parameters<CompensateFn>[0] | undefined;

    const compensateFn: CompensateFn = (context) => {
      capturedContext = context;
    };

    await expect(
      AgentUnit.fail<string>(primaryError)
        .compensate(compensateFn)
        .run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("detailed failure message");

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.error).toBeInstanceOf(Error);
    expect(capturedContext!.error.message).toBe("detailed failure message");
    expect(capturedContext!.agentContext).toBe(ctx);
  });

  it("Story 4: compensation that itself throws — surfaces CompensationError with both errors", async () => {
    // N68 fix: compensation errors were previously silently swallowed so
    // partially-restored external state was indistinguishable from a clean
    // rollback. The new contract: when compensation itself throws, wrap both
    // errors in CompensationError so the caller can investigate state.
    const primaryError = new Error("primary failed");
    const compensationThrow = new Error("compensation error");

    const compensateFn: CompensateFn = () => {
      throw compensationThrow;
    };

    const err = await AgentUnit.fail<string>(primaryError)
      .compensate(compensateFn)
      .run(ctx, { trustMode: "legacy" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(CompensationError);
    expect(err.originalError).toBe(primaryError);
    expect(err.compensationError).toBe(compensationThrow);
    expect(err.message).toContain("primary failed");
    expect(err.message).toContain("compensation error");
  });

  it("Story 5: compensation succeeds — original error propagates unchanged", async () => {
    const primaryError = new Error("primary failed");
    const compensateFn = vi.fn<CompensateFn>().mockResolvedValue(undefined);

    await expect(
      AgentUnit.fail<string>(primaryError)
        .compensate(compensateFn)
        .run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("primary failed");

    expect(compensateFn).toHaveBeenCalledTimes(1);
  });
});
