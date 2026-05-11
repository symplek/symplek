/**
 * @module facade.test - Unit tests for Weft callable namespace (OC-0-B)
 * @description Confirms Weft is a callable namespace with stream, agent,
 *   configure, providers, and run methods. Uses mocked providers — no real API calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Weft } from "../facade";
import type {
  AIRequest,
  AIResponse,
  Provider,
  StreamChunk,
} from "../providers/interface";
import { providerRegistry } from "../providers/registry";

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
  providerRegistry.clear();
  vi.restoreAllMocks();
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft() — direct call returns WeftBuilder
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft() direct call", () => {
  it("returns an object with .run() and .toUnit()", () => {
    const builder = Weft("some task");
    expect(typeof builder.run).toBe("function");
    expect(typeof builder.toUnit).toBe("function");
  });

  it("is thenable (PromiseLike)", () => {
    const builder = Weft("some task");
    expect(typeof builder.then).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weft.configure()
// ─────────────────────────────────────────────────────────────────────────────

describe("Weft.configure()", () => {
  it("does not throw when called with valid options", () => {
    expect(() =>
      Weft.configure({ provider: "mock", model: "mock-model", debug: false }),
    ).not.toThrow();
  });

  it("accepts a partial config without throwing", () => {
    expect(() => Weft.configure({ model: "gpt-4o" })).not.toThrow();
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
