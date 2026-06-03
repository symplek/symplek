/**
 * @module facade.test - Unit tests for Weft callable namespace (OC-0-B)
 * @description Confirms Weft is a callable namespace with stream, agent,
 *   configure, providers, and run methods. Uses mocked providers — no real API calls.
 *   Contract 1 (wave-0-design.md) test obligations are in the "configure() — Contract 1"
 *   describe block at the bottom of this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { Weft, _resetForTesting } from "../facade";
import type {
  AIRequest,
  AIResponse,
  Provider,
  StreamChunk,
} from "../providers/interface";
import { providerRegistry } from "../providers/registry";
import { detectProvider, selectModelForTask } from "../providers/auto";
import { traceManager } from "../trace";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK PROVIDER
// ─────────────────────────────────────────────────────────────────────────────

function makeMockProvider(id = "mock"): Provider {
  return {
    id,
    name: `Mock (${id})`,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      structuredOutput: false,
      maxContextTokens: 4096,
    },
    async generate(_req: AIRequest): Promise<AIResponse> {
      return {
        text: "mock response",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: "stop",
      };
    },
    async *stream(_req: AIRequest): AsyncIterable<StreamChunk> {
      yield { textDelta: "mock " };
      yield { textDelta: "chunk", finishReason: "stop" };
    },
    identify() {
      return { id: this.id, name: this.name };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  providerRegistry.clear();
  providerRegistry.register(makeMockProvider("mock"), true);
});

afterEach(() => {
  // Clear both the provider registry AND the global config singleton.
  // _resetForTesting() clears _globalConfig + _initPromise (via globalConfig.ts resetAll).
  _resetForTesting();
  providerRegistry.clear();
  vi.restoreAllMocks();
  // Reset traceManager.debug in case a test set it.
  traceManager.debug = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE TESTS — verify namespace methods exist with correct types
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft callable namespace — shape", () => {
  it("typeof Weft === 'function'", () => {
    expect(typeof Weft).toBe("function");
  });

  it("typeof Weft.run === 'function'", () => {
    expect(typeof Weft.run).toBe("function");
  });

  it("typeof Weft.stream === 'function'", () => {
    expect(typeof Weft.stream).toBe("function");
  });

  it("typeof Weft.agent === 'function'", () => {
    expect(typeof Weft.agent).toBe("function");
  });

  it("typeof Weft.configure === 'function'", () => {
    expect(typeof Weft.configure).toBe("function");
  });

  it("typeof Weft.providers === 'function'", () => {
    expect(typeof Weft.providers).toBe("function");
  });

  it("typeof Weft.unit === 'function'", () => {
    expect(typeof Weft.unit).toBe("function");
  });

  it("typeof Weft.of === 'function'", () => {
    expect(typeof Weft.of).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.unit() / Weft.of() — AgentUnit bridge
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.unit() bridge", () => {
  it("returns an AgentUnit with composition operators", () => {
    const unit = Weft.unit(async () => "hello");
    expect(typeof unit.run).toBe("function");
    expect(typeof unit.map).toBe("function");
    expect(typeof unit.consensus).toBe("function");
    expect(typeof unit.retry).toBe("function");
  });

  it("executes the computation when .run() is called", async () => {
    const ctx = createContext();
    const result = await Weft.unit(async () => 42).run(ctx);
    expect((result as { value: number }).value).toBe(42);
  });
});

describe("Weft.of() bridge", () => {
  it("lifts a plain value into an AgentUnit", async () => {
    const ctx = createContext();
    const result = await Weft.of("ship it").run(ctx);
    expect((result as { value: string }).value).toBe("ship it");
  });

  it("chains into .consensus() without a separate AgentUnit import", async () => {
    const ctx = createContext();
    const voted = await Weft.of("Ship the feature")
      .consensus([
        () => ({ decision: "approve" as const, confidence: 0.9 }),
        () => ({ decision: "approve" as const, confidence: 0.8 }),
      ])
      .run(ctx);
    expect((voted as { value: { approved: boolean } }).value.approved).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft() — direct call returns WeftBuilder
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft() direct call", () => {
  it("returns an object with .run(), .coordinate(), and .toUnit()", () => {
    const builder = Weft("some task");
    expect(typeof builder.run).toBe("function");
    expect(typeof builder.coordinate).toBe("function");
    expect(typeof builder.toUnit).toBe("function");
  });

  it(".coordinate() and .toUnit() return the same cached AgentUnit", () => {
    const builder = Weft("some task");
    const fromCoordinate = builder.coordinate();
    const fromToUnit = builder.toUnit();
    expect(fromCoordinate).toBe(fromToUnit);
  });

  it("is thenable (PromiseLike)", () => {
    const builder = Weft("some task");
    expect(typeof builder.then).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.configure() — shape tests (preserved from before Contract 1)
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.configure()", () => {
  it("does not throw when called with a known provider name and no apiKey", () => {
    // No apiKey → bootstrap is skipped; provider name validation still runs.
    expect(() =>
      Weft.configure({ provider: "openai", model: "gpt-4o", debug: false }),
    ).not.toThrow();
  });

  it("accepts a partial config without throwing", () => {
    expect(() => Weft.configure({ model: "gpt-4o" })).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.configure() — Contract 1 (wave-0-design.md) test obligations
// ─────────────────────────────────────────────────────────────────────────────

describe("configure() — Contract 1 obligations", () => {
  // Obligation 7: afterEach resets _globalConfig + registry so tests are isolated.
  // The global afterEach above handles this, but we assert it explicitly here.
  afterEach(() => {
    _resetForTesting();
    providerRegistry.clear();
    traceManager.debug = false;
  });

  // ── Obligation 1 ────────────────────────────────────────────────────────────
  it("(1) configure({ provider, apiKey }) registers named provider as registry default", async () => {
    Weft.configure({ provider: "openai", apiKey: "sk-test-key" });
    // The bootstrap is async; we must drain the init promise before checking registry.
    // The simplest way: await a fake ai() would do it, but since ai.ts is not wired
    // in this test file, we import and drain the init promise directly.
    const { getInitPromise, clearInitPromise } = await import("../globalConfig");
    const p = getInitPromise();
    if (p) { await p; clearInitPromise(); }

    expect(providerRegistry.getDefault()?.id).toBe("openai");
  });

  // ── Obligation 2 ────────────────────────────────────────────────────────────
  it("(2) configure({ model }) without provider → selectModelForTask returns configured model", () => {
    Weft.configure({ model: "claude-3-opus" });
    // No call-site model, no quality, simple short prompt → falls through to globalConfig.model
    const selected = selectModelForTask("hello");
    expect(selected).toBe("claude-3-opus");
  });

  // ── Obligation 3 ────────────────────────────────────────────────────────────
  it("(3) configure({ debug: true }) → traceManager.debug === true", () => {
    Weft.configure({ debug: true });
    expect(traceManager.debug).toBe(true);
  });

  // ── Obligation 4 ────────────────────────────────────────────────────────────
  it("(4) two configure() calls merge — second wins per field, first field retained", async () => {
    Weft.configure({ model: "gpt-4o-mini" });
    Weft.configure({ provider: "anthropic", apiKey: "sk-ant-test" });

    // Drain init promise.
    const { getInitPromise, clearInitPromise } = await import("../globalConfig");
    const p = getInitPromise();
    if (p) { await p; clearInitPromise(); }

    // model from first call is retained (second call didn't override it)
    const selected = selectModelForTask("hello");
    expect(selected).toBe("gpt-4o-mini");

    // provider from second call is registered as default
    expect(providerRegistry.getDefault()?.id).toBe("anthropic");
  });

  // ── Obligation 5 ────────────────────────────────────────────────────────────
  it("(5) caller without configure() and with OPENAI_API_KEY → detectProvider returns 'openai'", () => {
    // Env spy — ensure OPENAI_API_KEY is present and no registry default.
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-env-key";
    providerRegistry.clear(); // no configured provider

    try {
      expect(detectProvider()).toBe("openai");
    } finally {
      if (original === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = original;
      }
    }
  });

  // ── Obligation 6 ────────────────────────────────────────────────────────────
  it("(6) unknown provider value → throws WeftError with code PROVIDER_ERROR", () => {
    expect(() =>
      Weft.configure({ provider: "unkown-provider-xyz", apiKey: "sk-test" }),
    ).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
  });

  // ── Obligation 7 (isolation) ─────────────────────────────────────────────────
  it("(7) afterEach clears _globalConfig: selectModelForTask returns default after reset", () => {
    // This test runs AFTER the afterEach of the previous test clears state.
    // If isolation works, selectModelForTask returns the hardcoded default, not "claude-3-opus".
    const selected = selectModelForTask("hello");
    expect(selected).toBe("gpt-4o-mini");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.providers()
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.providers()", () => {
  it("returns an array", () => {
    const result = Weft.providers();
    expect(Array.isArray(result)).toBe(true);
  });

  it("each entry has id, name, configured fields", () => {
    const result = Weft.providers();
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.name).toBe("string");
      expect(typeof p.configured).toBe("boolean");
    }
  });

  it("includes the registered mock provider as configured:true", () => {
    const result = Weft.providers();
    const mock = result.find((p) => p.id === "mock");
    expect(mock).toBeDefined();
    expect(mock?.configured).toBe(true);
  });

  it("includes known providers even if not registered", () => {
    // Clear registry so no providers are registered
    providerRegistry.clear();
    const result = Weft.providers();
    const ids = result.map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.agent()
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.agent()", () => {
  it("returns an object with a .prompt() method", () => {
    const agent = Weft.agent({ model: "mock-model" });
    expect(typeof agent.prompt).toBe("function");
  });

  it(".prompt() returns a builder with .run()", () => {
    const agent = Weft.agent();
    const promptBuilder = agent.prompt("Hello");
    expect(typeof promptBuilder.run).toBe("function");
  });

  it("works with no config argument", () => {
    expect(() => Weft.agent()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.stream()
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.stream()", () => {
  it("returns an async generator", () => {
    const gen = Weft.stream("task");
    // An async generator has a Symbol.asyncIterator
    expect(typeof gen[Symbol.asyncIterator]).toBe("function");
  });

  it("yields string chunks from the mock provider", async () => {
    const chunks: string[] = [];
    for await (const chunk of Weft.stream("hello")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(typeof chunks[0]).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION TESTS — three Codex blocking bugs (wave-0 hardening)
// ─────────────────────────────────────────────────────────────────────────────

describe("Bug 1 — configure({ model }) beats prompt heuristics", () => {
  afterEach(() => {
    _resetForTesting();
    providerRegistry.clear();
  });

  it("complex prompt does NOT override a configured Anthropic model", () => {
    // Before fix: selectModelForTask ran the heuristic first and returned "gpt-4o"
    // for a long prompt even when configure({ model }) had been called.
    Weft.configure({ model: "claude-3-5-sonnet-20241022" });

    // A prompt that would trigger the complexity heuristic (length > 500 chars)
    const longComplexPrompt = "analyze ".repeat(100);
    const selected = selectModelForTask(longComplexPrompt);

    // Must return the configured model, NOT the heuristic "gpt-4o"
    expect(selected).toBe("claude-3-5-sonnet-20241022");
  });

  it("keyword heuristic does NOT override a configured model", () => {
    Weft.configure({ model: "gemini-1.5-pro" });
    // 'analyze' keyword would previously trigger the gpt-4o heuristic
    const selected = selectModelForTask("Please analyze this document.");
    expect(selected).toBe("gemini-1.5-pro");
  });

  it("call-site options.model still beats globalConfig.model", () => {
    Weft.configure({ model: "claude-3-5-sonnet-20241022" });
    const selected = selectModelForTask("hello", { model: "gpt-4o-mini" });
    expect(selected).toBe("gpt-4o-mini");
  });

  it("without configure(), complex prompt still returns heuristic gpt-4o", () => {
    // Backward-compatible: callers who never call configure() are unaffected.
    const longComplexPrompt = "analyze ".repeat(100);
    const selected = selectModelForTask(longComplexPrompt);
    expect(selected).toBe("gpt-4o");
  });
});

describe("Bug 2 — configure() then stream() sees the registered provider", () => {
  afterEach(() => {
    _resetForTesting();
    providerRegistry.clear();
    vi.restoreAllMocks();
  });

  it("Weft.stream() drains _initPromise so the configured provider is available", async () => {
    // Register the mock as a realistic "anthropic" provider so we can verify
    // that the provider is found after configure() + stream() interaction.
    const anthropicMock = makeMockProvider("anthropic");
    // Make it the registered default AFTER configure wires it via _bootstrapProvider.
    // We simulate what _bootstrapProvider does: register and set as default.
    // The actual adapter factories hit real SDKs; we override by registering first,
    // then calling configure() with a partial object that skips the real factory.
    //
    // Simpler approach: spy on providerRegistry.register to capture the call,
    // then verify stream() awaited the initPromise before resolving the provider.

    // Clear the beforeEach mock provider
    providerRegistry.clear();

    // Manually pre-register the mock as "openai" to simulate what _bootstrapProvider
    // would do after configure({ provider: "openai", apiKey }). Then verify stream()
    // uses it (which requires having drained the init promise that registers it).
    const { setInitPromise } = await import("../globalConfig");

    // Set up an init promise that registers the provider with a small async delay —
    // this proves stream() awaits it rather than falling through to a stale registry.
    let bootstrapResolved = false;
    setInitPromise(
      (async () => {
        await Promise.resolve(); // one tick
        providerRegistry.register(makeMockProvider("openai"), true);
        bootstrapResolved = true;
      })(),
    );

    // stream() must drain the init promise, then find the registered "openai" provider.
    const chunks: string[] = [];
    for await (const chunk of Weft.stream("hello", { provider: "openai" })) {
      chunks.push(chunk);
    }

    expect(bootstrapResolved).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("Bug 3 — configure({ provider: 'openrouter' }) throws PROVIDER_ERROR", () => {
  afterEach(() => {
    _resetForTesting();
    providerRegistry.clear();
  });

  it("throws WeftError PROVIDER_ERROR instead of silently misrouting to api.openai.com", () => {
    expect(() =>
      Weft.configure({ provider: "openrouter", apiKey: "sk-or-test" }),
    ).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
  });

  it("error message explains openrouter is not yet supported", () => {
    let thrownError: unknown;
    try {
      Weft.configure({ provider: "openrouter", apiKey: "sk-or-test" });
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError).toBeDefined();
    // The error why-text lists the supported providers; "openrouter" should NOT be in that list
    const errorMessage = String(
      (thrownError as { why?: string })?.why ?? thrownError,
    );
    expect(errorMessage).toContain("openrouter");
  });

  it("Weft.providers() does NOT advertise openrouter as a known provider", () => {
    providerRegistry.clear();
    const providers = Weft.providers();
    const ids = providers.map((p) => p.id);
    expect(ids).not.toContain("openrouter");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — OPENROUTER_API_KEY must not produce a broken registry-miss path
// ─────────────────────────────────────────────────────────────────────────────

describe("Regression — OPENROUTER_API_KEY alone does not auto-detect openrouter", () => {
  // Captures the Codex blocking finding: detectProvider() was returning "openrouter"
  // when only OPENROUTER_API_KEY was set, then crashing with "provider not found in
  // registry" (no adapter exists). The correct outcome is the clear "no supported
  // provider detected" PROVIDER_ERROR, not a silent registry miss.
  // TODO(Wave 3 / Contract 2): remove this test once the OpenRouter adapter lands.

  const savedKeys: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot and strip all supported provider keys so only OPENROUTER_API_KEY is visible.
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "OPENROUTER_API_KEY",
    ]) {
      savedKeys[key] = process.env[key];
      delete process.env[key];
    }
    process.env.OPENROUTER_API_KEY = "sk-or-regression-key";
    providerRegistry.clear(); // no registered default
  });

  afterEach(() => {
    // Restore env to pre-test state.
    for (const [key, value] of Object.entries(savedKeys)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    _resetForTesting();
    providerRegistry.clear();
  });

  it("detectProvider() does NOT return 'openrouter'", () => {
    let result: string | undefined;
    let thrown: unknown;
    try {
      result = detectProvider();
    } catch (e) {
      thrown = e;
    }
    // Either throws (correct) or returns a non-openrouter value (should not happen here
    // since no other keys are set, but guard against future priority changes).
    if (result !== undefined) {
      expect(result).not.toBe("openrouter");
    } else {
      // The throw path is the expected one: clear PROVIDER_ERROR, not registry miss.
      expect(thrown).toBeDefined();
      expect((thrown as { code?: string })?.code).toBe("PROVIDER_ERROR");
    }
  });

  it("throws PROVIDER_ERROR (no supported provider), not a registry-miss crash", () => {
    // The old code returned "openrouter" here and the caller later crashed with
    // 'Provider "openrouter" not found in registry'. The new code must throw
    // PROVIDER_ERROR at detection time with a helpful message.
    expect(() => detectProvider()).toThrow(
      expect.objectContaining({ code: "PROVIDER_ERROR" }),
    );
  });

  it("PROVIDER_ERROR message does not mention a registry lookup failure", () => {
    let thrownError: unknown;
    try {
      detectProvider();
    } catch (e) {
      thrownError = e;
    }
    const why = String((thrownError as { why?: string })?.why ?? thrownError);
    // Must be the "no API keys found" message, not something about registry or adapter.
    expect(why).toContain("No AI provider API keys found");
    expect(why).not.toMatch(/not found in registry/i);
  });
});
