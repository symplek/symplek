/**
 * @module lazy-bootstrap.test
 *
 * A provider key in the environment must be enough to run, with no call to
 * Symplek.configure(). Before this was fixed, detectProvider() returned
 * "openai" from OPENAI_API_KEY, the registry had no such provider, and the
 * first call failed with "Provider not found".
 *
 * The provider adapters are replaced with in-memory fakes, so nothing here
 * touches the network. What is under test is resolution and registration:
 * the real registry, the real detection, the real ai()/stream()/executeAgent().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTesting, Symplek } from "../facade";
import type { AIRequest, Provider } from "../providers/interface";
import { providerRegistry } from "../providers/registry";

const adapterLoads: Array<{ id: string; apiKey: string }> = [];

function fakeProvider(id: string, apiKey: string): Provider {
  adapterLoads.push({ id, apiKey });
  return {
    id,
    name: `fake-${id}`,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      structuredOutput: false,
      maxContextTokens: 4096,
    },
    async generate(_request: AIRequest) {
      return {
        text: `reply from ${id}`,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: "stop" as const,
      };
    },
    async *stream(_request: AIRequest) {
      yield { textDelta: `stream from ${id}`, finishReason: "stop" as const };
    },
  } as unknown as Provider;
}

vi.mock("../providers/openai", () => ({
  createOpenAIProvider: async (apiKey: string) => fakeProvider("openai", apiKey),
}));
vi.mock("../providers/anthropic", () => ({
  createAnthropicProvider: async (apiKey: string) =>
    fakeProvider("anthropic", apiKey),
}));
vi.mock("../providers/google", () => ({
  createGoogleProvider: async (apiKey: string) => fakeProvider("google", apiKey),
}));

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  providerRegistry.clear();
  _resetForTesting();
  adapterLoads.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  providerRegistry.clear();
  _resetForTesting();
});

describe("registerProviderFromEnv", () => {
  it("registers the adapter, built with the key from the environment", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const { registerProviderFromEnv } = await import("../providers/bootstrap");

    expect(await registerProviderFromEnv("anthropic")).toBe(true);
    expect(providerRegistry.get("anthropic")?.name).toBe("fake-anthropic");
    expect(adapterLoads).toEqual([{ id: "anthropic", apiKey: "sk-ant-from-env" }]);
  });

  it("does nothing when the provider is already registered", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    const explicit = fakeProvider("openai", "explicit");
    providerRegistry.register(explicit, true);
    adapterLoads.length = 0;
    const { registerProviderFromEnv } = await import("../providers/bootstrap");

    expect(await registerProviderFromEnv("openai")).toBe(false);
    expect(providerRegistry.get("openai")).toBe(explicit);
    expect(adapterLoads).toEqual([]);
  });

  it("does nothing without a key, or for a provider it has no adapter for", async () => {
    const { registerProviderFromEnv } = await import("../providers/bootstrap");

    expect(await registerProviderFromEnv("openai")).toBe(false);
    expect(await registerProviderFromEnv("no-such-provider")).toBe(false);
    expect(providerRegistry.getAll()).toEqual([]);
  });

  it("leaves an existing default provider as the default", async () => {
    providerRegistry.register(fakeProvider("anthropic", "explicit"), true);
    process.env.OPENAI_API_KEY = "sk-from-env";
    const { registerProviderFromEnv } = await import("../providers/bootstrap");

    expect(await registerProviderFromEnv("openai")).toBe(true);
    expect(providerRegistry.get("openai")).toBeDefined();
    expect(providerRegistry.getDefault()?.id).toBe("anthropic");
  });

  it("registers one adapter when first calls race", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    const { registerProviderFromEnv } = await import("../providers/bootstrap");
    const register = vi.spyOn(providerRegistry, "makeAvailable");

    const outcomes = await Promise.all([
      registerProviderFromEnv("openai"),
      registerProviderFromEnv("openai"),
      registerProviderFromEnv("openai"),
    ]);
    // All three calls were in flight together (none saw a registered
    // provider on entry), and only the first to finish registered: a later
    // one must not replace an adapter that may already be in use.
    expect(outcomes).toEqual([true, true, true]);
    expect(register).toHaveBeenCalledTimes(1);
    register.mockRestore();
  });
});

describe("an environment key alone is enough to run", () => {
  it("ai() answers with no configure() call", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    const { ai } = await import("../ai");

    expect(await ai("hello")).toBe("reply from openai");
    expect(adapterLoads).toEqual([{ id: "openai", apiKey: "sk-from-env" }]);
  });

  it("stream() yields with no configure() call", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const { stream } = await import("../streaming");

    const chunks: string[] = [];
    for await (const chunk of stream("hello")) chunks.push(chunk);
    expect(chunks.join("")).toBe("stream from anthropic");
  });

  it("executeAgent() answers with no configure() call", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-from-env";
    const { executeAgent } = await import("../agent/executor");

    const result = await executeAgent("hello", {});
    expect(result.text).toBe("reply from google");
  });

  it("reaching for a second provider by id does not re-route later calls", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const { ai } = await import("../ai");

    expect(await ai("first")).toBe("reply from openai");
    expect(await ai("second", { provider: "anthropic" })).toBe(
      "reply from anthropic",
    );
    expect(await ai("third")).toBe("reply from openai");
  });
});

describe("which provider an unnamed call uses", () => {
  it("follows the documented key order, not whichever provider was used first", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const { ai } = await import("../ai");

    // Anthropic is reached for first, by name.
    expect(await ai("first", { provider: "anthropic" })).toBe(
      "reply from anthropic",
    );
    // A call that names no provider still goes to the first key in the
    // documented order (OpenAI, Anthropic, Google).
    expect(await ai("second")).toBe("reply from openai");
    expect(providerRegistry.getDefault()).toBeUndefined();
  });

  it("a configured provider stays the default over any environment key", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    Symplek.configure({ provider: "anthropic", apiKey: "sk-ant-configured" });
    const { ai } = await import("../ai");

    expect(await ai("first")).toBe("reply from anthropic");
    expect(await ai("second", { provider: "openai" })).toBe("reply from openai");
    expect(await ai("third")).toBe("reply from anthropic");
  });
});

describe("when no provider can be resolved", () => {
  it("says no key was found when the environment is empty", async () => {
    const { ai } = await import("../ai");
    await expect(ai("hello")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(ai("hello")).rejects.toThrow(/No AI provider API keys found/);
  });

  it("says the provider is missing when configure() got a key without one", async () => {
    Symplek.configure({ apiKey: "sk-orphan-key" });
    const { ai } = await import("../ai");

    await expect(ai("hello")).rejects.toThrow(/apiKey but no provider/);
  });
});

describe("configure() choices are honoured, never silently replaced", () => {
  it("a configured provider with no key fails naming that provider", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    Symplek.configure({ provider: "anthropic" });
    const { ai } = await import("../ai");

    // The OpenAI key in the environment must not capture the call.
    await expect(ai("hello")).rejects.toThrow(/anthropic/);
    expect(adapterLoads.map((load) => load.id)).not.toContain("openai");
  });

  it("an apiKey with no provider is an error even when an environment key exists", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    Symplek.configure({ apiKey: "sk-orphan-key" });
    const { ai } = await import("../ai");

    await expect(ai("hello")).rejects.toThrow(/apiKey but no provider/);
    expect(adapterLoads).toEqual([]);
  });

  it("executeAgent() waits for the configured provider and uses its model table", async () => {
    Symplek.configure({ provider: "anthropic", apiKey: "sk-ant-configured" });
    const { executeAgent } = await import("../agent/executor");

    const result = await executeAgent("hello", {});
    expect(result.text).toBe("reply from anthropic");
  });

  it("a failed bootstrap is reported once and does not poison later calls", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    const { setInitPromise } = await import("../globalConfig");
    setInitPromise(Promise.reject(new Error("openai is not installed")));
    const { ai } = await import("../ai");

    await expect(ai("first", { provider: "anthropic" })).rejects.toThrow(
      /openai is not installed/,
    );
    expect(await ai("second", { provider: "anthropic" })).toBe(
      "reply from anthropic",
    );
  });
});
