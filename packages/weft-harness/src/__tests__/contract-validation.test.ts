/**
 * @module contract-validation.test - Contract validation gate in the execute operator
 * @description Verifies that execute() enforces VerifiedPlan.expectedOutput when
 * a schema with a .parse() method is supplied, and is a no-op when expectedOutput
 * is absent or does not carry a .parse() method.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createContext } from "@weft/core";
import { describe, expect, it, vi } from "vitest";
import { ContractViolationError } from "../errors";
import type { SdkSession } from "../operators/execute";
import { execute } from "../operators/execute";
import type { VerifiedPlan } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ctx = createContext();

function makeMockSession(finalMessage = "execution output"): SdkSession {
  return {
    async run(_options) {
      return { finalMessage };
    },
  };
}

function makeVerifiedPlan<T>(expectedOutput?: T): VerifiedPlan<T> {
  return {
    plan: {
      id: "plan-contract-test",
      intent: "test intent",
      steps: [],
      requiredTools: [],
      estimatedImpact: "P2",
      sources: [],
    },
    votes: [],
    approvalScore: 0.9,
    expectedOutput,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("execute() — contract validation", () => {
  it("does not throw when expectedOutput is undefined", async () => {
    const verified = makeVerifiedPlan<unknown>(undefined);
    const session = makeMockSession("hello");

    const unit = execute(session, verified);
    await expect(unit.run(ctx, { trustMode: "legacy" })).resolves.toBeDefined();
  });

  it("does not throw when expectedOutput has no .parse() method (plain value)", async () => {
    // A plain string as expectedOutput — no duck-typed .parse() — no validation runs.
    const verified = makeVerifiedPlan<string>(
      "Refactor complete. validateEmail moved to src/utils/email.ts",
    );
    const session = makeMockSession("different output");

    const unit = execute(session, verified);
    await expect(unit.run(ctx, { trustMode: "legacy" })).resolves.toBeDefined();
  });

  it("does not throw when expectedOutput schema .parse() succeeds", async () => {
    const successSchema = {
      description: "SuccessSchema",
      parse: vi.fn().mockReturnValue(true),
    };
    const verified = makeVerifiedPlan(successSchema);
    const session = makeMockSession("valid output");

    const unit = execute(session, verified);
    await expect(unit.run(ctx, { trustMode: "legacy" })).resolves.toBeDefined();

    // .parse() was called with the actual finalMessage
    expect(successSchema.parse).toHaveBeenCalledOnce();
    expect(successSchema.parse).toHaveBeenCalledWith("valid output");
  });

  it("throws ContractViolationError when schema .parse() rejects the output", async () => {
    const failSchema = {
      description: "StrictOutputSchema",
      parse: vi.fn().mockImplementation(() => {
        throw new Error("Expected object, got string");
      }),
    };
    const verified = makeVerifiedPlan(failSchema);
    const session = makeMockSession("unexpected string output");

    const unit = execute(session, verified);
    await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
      ContractViolationError,
    );
  });

  it("ContractViolationError carries planId and schema description", async () => {
    const failSchema = {
      description: "MigrationOutputSchema",
      parse: vi.fn().mockImplementation(() => {
        throw new Error("Validation failed");
      }),
    };
    const verified = makeVerifiedPlan(failSchema);
    const session = makeMockSession("bad output");

    const unit = execute(session, verified);

    let caught: unknown;
    try {
      await unit.run(ctx, { trustMode: "legacy" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ContractViolationError);
    const err = caught as ContractViolationError;
    expect(err.planId).toBe("plan-contract-test");
    expect(err.schemaDescription).toBe("MigrationOutputSchema");
    expect(err.actualShape).toContain("bad output");
  });

  it("ContractViolationError uses fallback description when schema.description is absent", async () => {
    const schemaWithoutDescription = {
      parse: vi.fn().mockImplementation(() => {
        throw new Error("nope");
      }),
    };
    const verified = makeVerifiedPlan(schemaWithoutDescription);
    const session = makeMockSession("output");

    const unit = execute(session, verified);

    let caught: unknown;
    try {
      await unit.run(ctx, { trustMode: "legacy" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ContractViolationError);
    expect((caught as ContractViolationError).schemaDescription).toBe("schema");
  });
});
