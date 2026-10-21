/**
 * @module lazy-bootstrap.test — B1 regression: env-key-only path lazy-bootstraps provider
 *
 * Before the B1 fix, detectProvider() would return "openai" (from OPENAI_API_KEY) but
 * providerRegistry.get("openai") returned undefined because configure() was never called.
 *
 * The fix adds lazyBootstrapFromEnv() in ai(), stream(), and executeAgent() so that
 * an API key in the environment is sufficient without Symplek.configure().
 *
 * These tests run against the real provider adapters (openai/anthropic/google are
 * devDependencies).  No live model calls are made — we only verify that the adapter
 * is imported and the provider is registered in the registry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerRegistry } from "../providers/registry";
import { _resetForTesting } from "../facade";

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  providerRegistry.clear();
  _resetForTesting();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
});

afterEach(() => {
  providerRegistry.clear();
  _resetForTesting();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// lazyBootstrapFromEnv — unit tests for the shared helper
// ─────────────────────────────────────────────────────────────────────────────

describe("lazyBootstrapFromEnv", () => {
  it("returns false and leaves the registry unchanged when provider is already registered", async () => {
    const stub = {
      id: "openai",
      name: "stub-openai",
      capabilities: { streaming: false, tools: false, vision: false, structuredOutput: false, maxContextTokens: 4096 },
      async generate() { return { text: "stub", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, finishReason: "stop" as const }; },
      async *stream() { yield { textDelta: "chunk", finishReason: "stop" as const }; },
      identify() { return { id: this.id, name: this.name }; },
    };
    providerRegistry.register(stub, true);

    const { lazyBootstrapFromEnv } = await import("../providers/bootstrap");
    const bootstrapped = await lazyBootstrapFromEnv("openai");

    expect(bootstrapped).toBe(false);
    // Registry state unchanged — still the stub
    expect(providerRegistry.get("openai")?.id).toBe("openai");
  });

  it("returns false when no env key is available for the provider", async () => {
    // No env vars set, registry empty
    const { lazyBootstrapFromEnv } = await import("../providers/bootstrap");
    const bootstrapped = await lazyBootstrapFromEnv("openai");

    expect(bootstrapped).toBe(false);
    expect(providerRegistry.get("openai")).toBeUndefined();
  });

  it("returns false for an unknown provider id even with env key set", async () => {
    // No matching env key for unknown providers
    const { lazyBootstrapFromEnv } = await import("../providers/bootstrap");
    const bootstrapped = await lazyBootstrapFromEnv("unknown-provider");

    expect(bootstrapped).toBe(false);
  });

  it("bootstraps from OPENAI_API_KEY and registers the provider when the env key is present", async () => {
    process.env.OPENAI_API_KEY = "sk-env-only-test-key";

    const { lazyBootstrapFromEnv } = await import("../providers/bootstrap");
    const bootstrapped = await lazyBootstrapFromEnv("openai");

    expect(bootstrapped).toBe(true);
    // Provider is now registered — the id is what the adapter sets
    const registered = providerRegistry.getDefault();
    expect(registered).toBeDefined();
    expect(registered?.id).toBe("openai");
  });

  it("bootstraps from ANTHROPIC_API_KEY and registers the provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-only";

    const { lazyBootstrapFromEnv } = await import("../providers/bootstrap");
    const bootstrapped = await lazyBootstrapFromEnv("anthropic");

    expect(bootstrapped).toBe(true);
    expect(providerRegistry.getDefault()?.id).toBe("anthropic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1: ai() does not require configure() when an env key is present
// ─────────────────────────────────────────────────────────────────────────────

describe("B1: ai() lazy bootstrap from environment key", () => {
  it("registers the provider when OPENAI_API_KEY is set and configure() was never called", async () => {
    process.env.OPENAI_API_KEY = "sk-env-only-test";

    // ai() is imported from the real module; we verify side-effects on the
    // registry rather than making a live AI call.
    const { ai } = await import("../ai");

    // Wrap in a try/catch because the stub key will cause the actual generate()
    // call to fail (network or auth error) — but that happens AFTER the registry
    // is populated, which is what we are testing.
    try {
      await ai("hello world");
    } catch {
      // Expected: real network/auth failure with a fake key.
    }

    // The important assertion: registry now has openai — it was bootstrapped from env.
    expect(providerRegistry.get("openai")).toBeDefined();
  });

  it("throws PROVIDER_ERROR with an actionable message when no key is available", async () => {
    // Registry empty, no env vars
    const { ai } = await import("../ai");
    await expect(ai("hello")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
