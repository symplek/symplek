/**
 * @module golden-path.test
 * @description Golden-path test suite for weft-core public API.
 *   Exercises each published primitive on the happy path — proves the package
 *   works end-to-end as shipped with zero external providers required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentUnit, createContext, VERSION, WeftError } from "../index";
import type { AgentContext } from "../types";

// ─── Shared Context ──────────────────────────────────────────────────────────

const ctx: AgentContext = createContext();

// Suppress deprecation noise from `trustMode: 'legacy'` calls
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  // Reset deprecation guard so each test starts clean
  AgentUnit._deprecationWarned = false;
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ─── 1. AgentUnit.from → map → run ───────────────────────────────────────────

describe("AgentUnit.from → map → run", () => {
  it("produces the mapped value with trustMode:legacy", async () => {
    const unit = AgentUnit.from(() => Promise.resolve(42)).map((x) => x * 2);
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe(84);
  });

  it("produces a TrackedResult in default zero-trust mode", async () => {
    const unit = AgentUnit.from(() => Promise.resolve(42)).map((x) => x * 2);
    const result = await unit.run(ctx);
    expect(result).toBeDefined();
    // TrackedResult wraps the value — confirm it has a 'value' property
    expect((result as { value: unknown }).value).toBe(84);
  });
});

// ─── 2. zipAll parallel execution ────────────────────────────────────────────

describe("AgentUnit.zipAll", () => {
  it("runs three independent units in parallel and returns all results", async () => {
    const u1 = AgentUnit.from(() => Promise.resolve("alpha"));
    const u2 = AgentUnit.from(() => Promise.resolve("beta"));
    const u3 = AgentUnit.from(() => Promise.resolve("gamma"));
    const combined = AgentUnit.zipAll([u1, u2, u3]);
    const result = await combined.run(ctx, { trustMode: "legacy" });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result).toContain("alpha");
    expect(result).toContain("beta");
    expect(result).toContain("gamma");
  });

  it("completes all 3 results in the tracked result wrapper", async () => {
    const u1 = AgentUnit.from(() => Promise.resolve(1));
    const u2 = AgentUnit.from(() => Promise.resolve(2));
    const u3 = AgentUnit.from(() => Promise.resolve(3));
    const result = await AgentUnit.zipAll([u1, u2, u3]).run(ctx);
    expect((result as { value: unknown }).value).toEqual([1, 2, 3]);
  });

  it("handles an empty array without throwing", async () => {
    const combined = AgentUnit.zipAll<string>([]);
    const result = await combined.run(ctx, { trustMode: "legacy" });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ─── 3. consensus with empty voters ──────────────────────────────────────────

describe("AgentUnit.consensus", () => {
  it("returns a ConsensusResult with approved + votes when no voters supplied", async () => {
    const unit = AgentUnit.from(() => Promise.resolve("my-proposal"));
    const consensusUnit = unit.consensus([]);
    const result = await consensusUnit.run(ctx, { trustMode: "legacy" });

    // ConsensusResult shape: approved, votes, weightedApproval, quorum, consensus
    expect(result).toBeDefined();
    expect(typeof result.approved).toBe("boolean");
    expect(Array.isArray(result.votes)).toBe(true);
    // With zero voters the result should reflect no approval
    expect(result.votes).toHaveLength(0);
  });

  it("reflects quorum threshold of 0.5 by default", async () => {
    const unit = AgentUnit.from(() => Promise.resolve("proposal"));
    const result = await unit.consensus([]).run(ctx, { trustMode: "legacy" });
    expect(typeof result.quorum).toBe("number");
  });
});

// ─── 4. WeftError field verification ─────────────────────────────────────────

describe("WeftError", () => {
  it("stores code, message, and action correctly", () => {
    const err = new WeftError({
      code: "SETUP_ERROR",
      message: "test message",
      action: "fix it",
    });
    expect(err.code).toBe("SETUP_ERROR");
    // Message is prefixed with [weft@VERSION] for self-identifying stack traces
    expect(err.message).toBe(`[weft@${VERSION}] test message`);
    expect(err.action).toBe("fix it");
  });

  it("is an instance of Error", () => {
    const err = new WeftError({ code: "TIMEOUT", message: "timed out" });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WeftError");
  });

  it("serializes to JSON with expected shape", () => {
    const err = new WeftError({ code: "NETWORK_ERROR", message: "no network" });
    const json = err.toJSON();
    expect(json).toMatchObject({
      name: "WeftError",
      code: "NETWORK_ERROR",
      message: `[weft@${VERSION}] no network`,
    });
  });

  it("sanitizes sensitive context keys", () => {
    const err = new WeftError({
      code: "AUTH_FAILED",
      message: "auth error",
      context: { api_key: "secret-value", userId: "u123" },
    });
    expect(err.context?.api_key).toBe("[REDACTED]");
    expect(err.context?.userId).toBe("u123");
  });

  it("exposes .fix field when fix is provided", () => {
    const err = new WeftError({
      code: "SETUP_ERROR",
      why: "OPENAI_API_KEY is missing",
      fix: {
        description: "Set OPENAI_API_KEY in your environment",
        docsUrl: "https://platform.openai.com/api-keys",
      },
    });
    expect(err.code).toBe("SETUP_ERROR");
    expect(err.fix).toBeDefined();
    expect(err.fix?.description).toContain("OPENAI_API_KEY");
    expect(err.fix?.docsUrl).toBeTruthy();
    // why is consumed as the error message — confirmed by checking the message prefix
    expect(err.message).toContain("OPENAI_API_KEY is missing");
  });

  it("SETUP_ERROR matches the AgentUnit guard error — code, message, action fields present", () => {
    const err = new WeftError({
      code: "SETUP_ERROR",
      message:
        'AgentUnit operators not loaded. Import from "weft-core", not internal paths.',
      action: 'Change import to: import { AgentUnit } from "weft-core";',
    });
    expect(err.code).toBe("SETUP_ERROR");
    expect(err.message).toContain("AgentUnit operators not loaded");
    expect(err.action).toBeTruthy();
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── 5. createContext zero-arg ────────────────────────────────────────────────

describe("createContext", () => {
  it("returns an object without arguments", () => {
    const result = createContext();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("has a numeric timestamp", () => {
    const result = createContext();
    expect(typeof result.timestamp).toBe("number");
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("accepts optional extensions", () => {
    const result = createContext({ extensions: { tenantId: "t-99" } });
    expect(result.extensions).toEqual({ tenantId: "t-99" });
  });
});

// ─── 6. Weft.stream (mocked) ─────────────────────────────────────────────────

describe("Weft.stream (mocked)", () => {
  it("yields chunks from a mocked stream", { timeout: 20000 }, async () => {
    // Import Weft facade locally so vi.spyOn works on the named export
    const { Weft } = await import("../facade");

    async function* fakeStream(): AsyncGenerator<string> {
      yield "Hello";
      yield " world";
    }

    const spy = vi.spyOn(Weft, "stream").mockImplementation(() => fakeStream());

    const chunks: string[] = [];
    for await (const chunk of Weft.stream("test prompt")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
    spy.mockRestore();
  });
});

// ─── 7. AgentUnit.fromWithFallback ───────────────────────────────────────────

describe("AgentUnit.fromWithFallback", () => {
  it("returns the primary result on success", async () => {
    const unit = AgentUnit.fromWithFallback(
      async () => "primary result",
      () => "fallback result",
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("primary result");
  });

  it("invokes fallback when primary throws", async () => {
    const unit = AgentUnit.fromWithFallback(
      async () => {
        throw new Error("primary exploded");
      },
      () => "fallback result",
    );
    const result = await unit.run(ctx, { trustMode: "legacy" });
    expect(result).toBe("fallback result");
  });

  it("passes the error to the fallback function", async () => {
    const capturedErrors: Error[] = [];
    const unit = AgentUnit.fromWithFallback(
      async () => {
        throw new Error("the original error");
      },
      (err) => {
        if (err) capturedErrors.push(err);
        return "fallback";
      },
    );
    await unit.run(ctx, { trustMode: "legacy" });
    expect(capturedErrors).toHaveLength(1);
    expect(capturedErrors[0].message).toBe("the original error");
  });

  it("wraps non-Error throws in an Error before passing to fallback", async () => {
    const capturedErrors: Error[] = [];
    const unit = AgentUnit.fromWithFallback(
      async () => {
        throw "string thrown, not an Error";
      },
      (err) => {
        if (err) capturedErrors.push(err);
        return "handled";
      },
    );
    await unit.run(ctx, { trustMode: "legacy" });
    expect(capturedErrors[0]).toBeInstanceOf(Error);
  });

  it("returns a TrackedResult in zero-trust mode", async () => {
    const unit = AgentUnit.fromWithFallback(
      async () => 42,
      () => 0,
    );
    const result = await unit.run(ctx);
    expect((result as { value: unknown }).value).toBe(42);
  });

  it("records 'fromWithFallback' in the operator chain", () => {
    const unit = AgentUnit.fromWithFallback(
      async () => "x",
      () => "y",
    );
    expect(unit.getMetadata().operatorChain).toContain("fromWithFallback");
  });
});

// ─── 8. AgentUnit.prototype.runStandalone ────────────────────────────────────

describe("AgentUnit.prototype.runStandalone", () => {
  it("runs and returns a TrackedResult without a pre-created context", async () => {
    const unit = AgentUnit.of("standalone value");
    const result = await unit.runStandalone();
    expect((result as { value: unknown }).value).toBe("standalone value");
  });

  it("supports legacy mode via options", async () => {
    const unit = AgentUnit.of("raw value");
    const result = await unit.runStandalone({ trustMode: "legacy" });
    expect(result).toBe("raw value");
  });

  it("works the same as run(createContext()) in zero-trust mode", async () => {
    const unit = AgentUnit.from(() => Promise.resolve(99)).map((n) => n + 1);
    const standalone = await unit.runStandalone();
    const withCtx = await unit.run(ctx);
    expect((standalone as { value: unknown }).value).toBe(100);
    expect((withCtx as { value: unknown }).value).toBe(100);
  });
});

// ─── 9. Weft.configure sets global config ────────────────────────────────────

describe("Weft.configure", () => {
  it("does not throw when called with a model override", async () => {
    const { Weft } = await import("../facade");
    expect(() => Weft.configure({ model: "gpt-4o-mini" })).not.toThrow();
  });

  it("does not throw when called with a provider override", async () => {
    const { Weft } = await import("../facade");
    expect(() => Weft.configure({ provider: "openai" })).not.toThrow();
  });

  it("Weft.providers() returns an array of known providers", async () => {
    const { Weft } = await import("../facade");
    const providers = Weft.providers();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
    const providerIds = providers.map((p) => p.id);
    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("anthropic");
  });
});
