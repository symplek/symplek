/**
 * @module __tests__/compensate
 * @description Tests for the AgentUnit .compensate() operator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompensateFn } from "../AgentUnit/operators/compensate";
import { AgentUnit, createContext } from "../index";
import type { AgentContext } from "../types";

describe("AgentUnit.compensate()", () => {
  const ctx: AgentContext = createContext();

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    AgentUnit._deprecationWarned = false;
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

  it("Story 4: compensation that itself throws — original error still propagates", async () => {
    const primaryError = new Error("primary failed");

    const compensateFn: CompensateFn = () => {
      throw new Error("compensation error");
    };

    await expect(
      AgentUnit.fail<string>(primaryError)
        .compensate(compensateFn)
        .run(ctx, { trustMode: "legacy" }),
    ).rejects.toThrow("primary failed");
  });
});
