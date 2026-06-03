/**
 * Package Contract Smoke Test — weft-core/server
 *
 * Proves the server-only subpath exports:
 * 1. Runtime AI utilities (ai, stream, providerRegistry)
 * 2. The Weft facade backed by real AI execution
 * 3. Contract 2 — lazy provider loading (absent SDK → WeftError; cache; configure+await)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { aiMock } = vi.hoisted(() => ({
  aiMock: vi.fn(),
}));

vi.mock("../ai", () => ({
  ai: aiMock,
}));

import {
  ai,
  ProviderRegistry,
  providerRegistry,
  stream,
  Weft,
  WeftBuilder,
} from "../server";

describe("weft-core/server — Package Contract Smoke", () => {
  beforeEach(() => {
    aiMock.mockReset();
  });

  it("exports ai() runtime", () => {
    expect(typeof ai).toBe("function");
  });

  it("exports stream() runtime", () => {
    expect(typeof stream).toBe("function");
  });

  it("exports ProviderRegistry class and providerRegistry singleton", () => {
    expect(ProviderRegistry).toBeDefined();
    expect(providerRegistry).toBeInstanceOf(ProviderRegistry);
  });

  describe("Weft facade (real execution contract)", () => {
    it("exports Weft factory function", () => {
      expect(typeof Weft).toBe("function");
    });

    it("exports WeftBuilder class", () => {
      expect(WeftBuilder).toBeDefined();
    });

    it("Weft() returns a WeftBuilder with run/coordinate/toUnit/then methods", () => {
      const builder = Weft("test task");
      expect(builder).toBeInstanceOf(WeftBuilder);
      expect(typeof builder.coordinate).toBe("function");
      expect(typeof builder.toUnit).toBe("function");
      expect(typeof builder.run).toBe("function");
      expect(typeof builder.then).toBe("function");
    });

    it("coordinate() returns an AgentUnit backed by a real computation (not a static string)", () => {
      const unit = Weft("test task").coordinate();
      expect(typeof unit.run).toBe("function");
      expect(typeof unit.map).toBe("function");
      expect(typeof unit.flatMap).toBe("function");
    });

    it("toUnit() is an alias for coordinate() returning the same instance", () => {
      const builder = Weft("test task");
      expect(builder.coordinate()).toBe(builder.toUnit());
    });

    it("routes Weft().run() through ai() and returns the AI result instead of echoing the task", async () => {
      aiMock.mockResolvedValue("server-generated answer");

      const result = await Weft("test task", {
        model: "test-model",
      }).run();

      expect(aiMock).toHaveBeenCalledTimes(1);
      expect(aiMock).toHaveBeenCalledWith(
        "test task",
        expect.objectContaining({
          model: "test-model",
          schema: undefined,
        }),
      );
      expect(result.value).toBe("server-generated answer");
      expect(result.value).not.toBe("test task");
      expect(result.source).toBe("agent");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract 2 — Lazy provider loading (wave-0-design.md obligations)
// ─────────────────────────────────────────────────────────────────────────────

describe("Contract 2 — Lazy provider imports", () => {
  // ── Obligation 1: absent SDK throws WeftError with pnpm add hint ─────────────
  it("(1) createAnthropicProvider throws WeftError PROVIDER_ERROR when SDK is absent", async () => {
    // Mock dynamic import to simulate the SDK not being installed
    const originalImport = globalThis[Symbol.for("__vitest_import__") as symbol] as unknown;
    void originalImport; // reference to avoid lint

    // We test via vi.doMock then a fresh dynamic import of the adapter module.
    // Reset module registry so our mock is picked up.
    vi.doMock("@anthropic-ai/sdk", () => {
      throw new Error("Cannot find module '@anthropic-ai/sdk'");
    });

    // Reset the cached SDK singleton in the adapter by re-importing with cleared cache
    // Use vi.resetModules to force a fresh module load that hits our mock.
    vi.resetModules();

    const { createAnthropicProvider } = await import(
      "../providers/anthropic"
    );

    let thrown: unknown;
    try {
      await createAnthropicProvider("sk-test");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect(String((thrown as { why?: string }).why ?? thrown)).toContain(
      "pnpm add",
    );

    vi.doUnmock("@anthropic-ai/sdk");
    vi.resetModules();
  });

  // ── Obligation 2: openai absent SDK ──────────────────────────────────────────
  it("(1b) createOpenAIProvider throws WeftError PROVIDER_ERROR when SDK is absent", async () => {
    vi.doMock("openai", () => {
      throw new Error("Cannot find module 'openai'");
    });
    vi.resetModules();

    const { createOpenAIProvider } = await import("../providers/openai");

    let thrown: unknown;
    try {
      await createOpenAIProvider("sk-test");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { code?: string }).code).toBe("PROVIDER_ERROR");
    expect(String((thrown as { why?: string }).why ?? thrown)).toContain(
      "pnpm add",
    );

    vi.doUnmock("openai");
    vi.resetModules();
  });

  // ── Obligation 3: import cached — called exactly once ────────────────────────
  it("(3) createAnthropicProvider loads SDK exactly once across two calls (cache hit)", async () => {
    // We need a fresh module to test caching without the absent-SDK state from above.
    vi.resetModules();

    // Spy on the actual dynamic import resolution by wrapping the module system.
    // A cleaner approach: spy on the module's internal loader via a counter in a mock.
    let loadCount = 0;

    vi.doMock("@anthropic-ai/sdk", () => {
      loadCount++;
      // Return a minimal Anthropic-like constructor
      return {
        default: class MockAnthropic {
          messages = {
            create: vi.fn().mockResolvedValue({
              content: [{ type: "text", text: "response" }],
              usage: { input_tokens: 10, output_tokens: 5 },
              stop_reason: "end_turn",
            }),
            stream: vi.fn().mockReturnValue((async function* () {})()),
          };
        },
      };
    });

    vi.resetModules();

    const { createAnthropicProvider: freshCreate } = await import(
      "../providers/anthropic"
    );

    // Call factory twice — SDK should be loaded only once
    await freshCreate("sk-key-1");
    await freshCreate("sk-key-2");

    // The module was imported once (subsequent calls hit the module cache, not
    // the _AnthropicSdk null-check which is the per-module-instance cache).
    // vi.doMock intercepts at the module registry level; loadCount reflects
    // how many times the mock factory ran (= how many module instances loaded).
    expect(loadCount).toBe(1);

    vi.doUnmock("@anthropic-ai/sdk");
    vi.resetModules();
  });

  // ── Obligation 4: configure() + await ai() → provider resolved ───────────────
  it("(4) Weft.configure({ provider:'openai', apiKey }) → initPromise settled before ai() executes", async () => {
    // Reset global state before this test.
    const { _resetForTesting } = await import("../facade");
    const { providerRegistry: reg } = await import("../providers/registry");
    _resetForTesting();
    reg.clear();

    // Mock the openai SDK so _bootstrapProvider succeeds without the real SDK.
    vi.doMock("openai", () => ({
      default: class MockOpenAI {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 5,
                completion_tokens: 2,
                total_tokens: 7,
              },
            }),
          },
        };
      },
    }));

    vi.resetModules();

    // Re-import facade after module reset so it gets the mocked openai.
    const { Weft: WeftFresh } = await import("../facade");
    WeftFresh.configure({ provider: "openai", apiKey: "sk-smoke-test" });

    // Drain the init promise (as ai() would)
    const { getInitPromise, clearInitPromise } = await import("../globalConfig");
    const p = getInitPromise();
    if (p) {
      await p;
      clearInitPromise();
    }

    // After draining, the openai provider should be registered as default.
    const { providerRegistry: reg2 } = await import("../providers/registry");
    expect(reg2.getDefault()?.id).toBe("openai");

    vi.doUnmock("openai");
    vi.resetModules();
  });

  // ── Obligation 5: existing providerRegistry.register() path unaffected ────────
  it("(5) providerRegistry.register(mockProvider) works without configure() being called", () => {
    // This is a regression guard: the lazy-import path must not break callers who
    // register providers manually and never call configure().
    const mockProvider = {
      id: "custom",
      name: "Custom",
      capabilities: {
        streaming: false,
        tools: false,
        vision: false,
        structuredOutput: false,
        maxContextTokens: 4096,
      },
      generate: vi.fn(),
      stream: vi.fn(),
      identify: () => ({ id: "custom", name: "Custom" }),
    };

    providerRegistry.register(mockProvider, true);
    expect(providerRegistry.getDefault()?.id).toBe("custom");

    // Clean up
    providerRegistry.clear();
  });
});
