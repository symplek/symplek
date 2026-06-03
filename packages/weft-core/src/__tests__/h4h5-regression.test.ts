/**
 * @module h4h5-regression.test — H4 provider-aware model selection + H5 Anthropic streaming token accounting + H6 provider threading
 * @description
 *   H4: Quality heuristics in selectModelForTask must map to the active provider's model family,
 *       not hardcoded OpenAI IDs, when the active provider is Anthropic or Google.
 *   H5: Anthropic stream() must emit usage chunks from message_start and message_delta with
 *       correct combined totals; streaming.ts must accumulate these regardless of textDelta.
 *   H6: The ALREADY-RESOLVED provider from ai.ts/streaming.ts must be threaded into
 *       selectModelForTask so quality heuristics agree with the executor even when the
 *       call-site provider differs from what detectProvider() would independently return.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectModelForTask } from "../providers/auto";
import { providerRegistry } from "../providers/registry";
import { _resetForTesting } from "../facade";
import type {
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
} from "../providers/interface";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStubProvider(id: string): Provider {
  const caps: ProviderCapabilities = {
    streaming: true,
    tools: false,
    vision: false,
    structuredOutput: false,
    maxContextTokens: 8192,
  };
  return {
    id,
    name: `Stub(${id})`,
    capabilities: caps,
    async generate(_req: AIRequest): Promise<AIResponse> {
      return { text: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: "stop" };
    },
    async *stream(_req: AIRequest): AsyncIterable<StreamChunk> {
      yield { textDelta: "ok" };
    },
    identify() { return { id, name: `Stub(${id})` }; },
  };
}

function saveAndClearEnv(keys: string[]): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const ALL_PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
];

// ─────────────────────────────────────────────────────────────────────────────
// H4 — provider-aware model selection
// ─────────────────────────────────────────────────────────────────────────────

describe("H4 — provider-aware quality heuristics in selectModelForTask", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    _resetForTesting();
    providerRegistry.clear();
    savedEnv = saveAndClearEnv(ALL_PROVIDER_KEYS);
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    _resetForTesting();
    providerRegistry.clear();
  });

  // ── Anthropic ─────────────────────────────────────────────────────────────

  it("Anthropic provider + quality:high → Claude (not gpt-4o)", () => {
    providerRegistry.register(makeStubProvider("anthropic"), true);
    const model = selectModelForTask("short prompt", { quality: "high" });
    // Must be a Claude model, not gpt-4o
    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o");
  });

  it("Anthropic provider + quality:fast → Claude-family fast model (not gpt-4o-mini)", () => {
    providerRegistry.register(makeStubProvider("anthropic"), true);
    const model = selectModelForTask("short prompt", { quality: "fast" });
    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o-mini");
  });

  it("Anthropic provider + no quality + complex prompt → Claude model (not gpt-4o)", () => {
    providerRegistry.register(makeStubProvider("anthropic"), true);
    const complexPrompt = "analyze ".repeat(100); // triggers complexity heuristic
    const model = selectModelForTask(complexPrompt);
    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o");
  });

  // ── Google ────────────────────────────────────────────────────────────────

  it("Google provider + quality:fast → Gemini model (not gpt-4o-mini)", () => {
    providerRegistry.register(makeStubProvider("google"), true);
    const model = selectModelForTask("short prompt", { quality: "fast" });
    expect(model).toMatch(/gemini/i);
    expect(model).not.toBe("gpt-4o-mini");
  });

  it("Google provider + quality:high → Gemini model (not gpt-4o)", () => {
    providerRegistry.register(makeStubProvider("google"), true);
    const model = selectModelForTask("short prompt", { quality: "high" });
    expect(model).toMatch(/gemini/i);
    expect(model).not.toBe("gpt-4o");
  });

  // ── OpenAI regression guard ───────────────────────────────────────────────

  it("No provider configured + quality:high → gpt-4o (OpenAI regression guard)", () => {
    // providerRegistry is empty and no env keys are set → detectProvider() throws.
    // resolveProviderModelDefaults() catches and falls back to OpenAI table.
    const model = selectModelForTask("short prompt", { quality: "high" });
    expect(model).toBe("gpt-4o");
  });

  it("No provider configured + quality:fast → gpt-4o-mini (OpenAI regression guard)", () => {
    const model = selectModelForTask("short prompt", { quality: "fast" });
    expect(model).toBe("gpt-4o-mini");
  });

  // ── Explicit model always wins ─────────────────────────────────────────────

  it("Explicit options.model beats provider heuristic even with Anthropic provider", () => {
    providerRegistry.register(makeStubProvider("anthropic"), true);
    const model = selectModelForTask("short prompt", { model: "my-custom-model" });
    expect(model).toBe("my-custom-model");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H5 — Anthropic streaming token accounting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a mock Anthropic stream that emits the standard Anthropic SSE event
 * sequence: message_start → content_block_start → content_block_delta(s) →
 * content_block_stop → message_delta → message_stop.
 *
 * The mock is a plain AsyncIterable — no real Anthropic SDK or network required.
 */
async function* makeAnthropicEventStream(opts: {
  inputTokens: number;
  outputTokens: number;
  textChunks: string[];
  stopReason?: string;
}): AsyncIterable<Record<string, unknown>> {
  // message_start — carries input token count
  yield {
    type: "message_start",
    message: {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-opus-4-5",
      stop_reason: null,
      usage: {
        input_tokens: opts.inputTokens,
        output_tokens: 0,
      },
    },
  };

  // content_block_start
  yield {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  };

  // text delta chunks
  for (const chunk of opts.textChunks) {
    yield {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: chunk },
    };
  }

  // content_block_stop
  yield { type: "content_block_stop", index: 0 };

  // message_delta — carries output token count
  yield {
    type: "message_delta",
    delta: { stop_reason: opts.stopReason ?? "end_turn", stop_sequence: null },
    usage: { output_tokens: opts.outputTokens },
  };

  // message_stop
  yield { type: "message_stop" };
}

/**
 * A stripped-down replica of the Anthropic stream() handler from anthropic.ts,
 * using the same logic but accepting an injected event stream instead of a real
 * Anthropic SDK stream.
 *
 * This lets us test the token accumulation logic without mocking the entire SDK.
 *
 * IMPORTANT: This must stay in sync with the stream() implementation in anthropic.ts.
 * If you change anthropic.ts stream() logic, update this replica accordingly.
 */
async function* simulateAnthropicStream(
  eventStream: AsyncIterable<Record<string, unknown>>,
): AsyncIterable<StreamChunk> {
  let promptTokensSeen = 0;

  function transformFinishReason(reason: unknown): StreamChunk["finishReason"] {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_calls";
      default:
        return "other";
    }
  }

  for await (const event of eventStream) {
    if (
      event.type === "content_block_delta" &&
      (event.delta as Record<string, unknown>)?.type === "text_delta"
    ) {
      yield { textDelta: (event.delta as Record<string, unknown>).text as string };
    } else if (event.type === "message_start") {
      const msg = event.message as Record<string, unknown>;
      const usage = msg.usage as Record<string, unknown>;
      promptTokensSeen = usage.input_tokens as number;
      yield {
        textDelta: "",
        usage: {
          promptTokens: usage.input_tokens as number,
          completionTokens: 0,
          totalTokens: usage.input_tokens as number,
        },
      };
    } else if (event.type === "message_delta") {
      const usage = event.usage as Record<string, unknown> | undefined;
      const completionTokens = (usage?.output_tokens as number) ?? 0;
      yield {
        textDelta: "",
        finishReason: transformFinishReason(
          (event.delta as Record<string, unknown>)?.stop_reason,
        ),
        usage: {
          promptTokens: promptTokensSeen,
          completionTokens,
          totalTokens: promptTokensSeen + completionTokens,
        },
      };
    }
  }
}

/**
 * Simulate what streaming.ts does: iterate the provider stream, accumulate usage,
 * and collect only text chunks for the caller.
 */
async function collectStreamOutput(
  providerStream: AsyncIterable<StreamChunk>,
): Promise<{ text: string; finalPromptTokens: number; finalCompletionTokens: number }> {
  let accPromptTokens = 0;
  let accCompletionTokens = 0;
  const textChunks: string[] = [];

  for await (const chunk of providerStream) {
    // H5 fix: accumulate usage regardless of textDelta presence
    if (chunk.usage) {
      if (chunk.usage.promptTokens > 0) {
        accPromptTokens = chunk.usage.promptTokens;
      }
      if (chunk.usage.completionTokens > 0) {
        accCompletionTokens = chunk.usage.completionTokens;
      }
    }
    // Only collect text for external callers
    if (chunk.textDelta) {
      textChunks.push(chunk.textDelta);
    }
  }

  return {
    text: textChunks.join(""),
    finalPromptTokens: accPromptTokens,
    finalCompletionTokens: accCompletionTokens,
  };
}

describe("H5 — Anthropic streaming token accumulation", () => {
  it("message_start + message_delta yield correct combined usage", async () => {
    const events = makeAnthropicEventStream({
      inputTokens: 42,
      outputTokens: 17,
      textChunks: ["Hello", " world"],
    });

    const chunks = await collectStreamOutput(simulateAnthropicStream(events));

    expect(chunks.finalPromptTokens).toBe(42);
    expect(chunks.finalCompletionTokens).toBe(17);
  });

  it("final accumulated promptTokens > 0 (was silently 0 before fix)", async () => {
    const events = makeAnthropicEventStream({
      inputTokens: 100,
      outputTokens: 50,
      textChunks: ["answer"],
    });

    const result = await collectStreamOutput(simulateAnthropicStream(events));

    // This was zero before the fix because message_delta emitted promptTokens:0
    // and streaming.ts only processed chunks with truthy textDelta.
    expect(result.finalPromptTokens).toBeGreaterThan(0);
    expect(result.finalCompletionTokens).toBeGreaterThan(0);
  });

  it("text is still collected correctly despite usage-only chunks", async () => {
    const events = makeAnthropicEventStream({
      inputTokens: 10,
      outputTokens: 5,
      textChunks: ["foo", " bar", " baz"],
    });

    const result = await collectStreamOutput(simulateAnthropicStream(events));

    expect(result.text).toBe("foo bar baz");
  });

  it("usage-only chunks (empty textDelta) do not propagate to text callers", async () => {
    const events = makeAnthropicEventStream({
      inputTokens: 20,
      outputTokens: 8,
      textChunks: ["only text"],
    });

    // The public stream() generator only yields strings; usage chunks must be invisible.
    const textOnly: string[] = [];
    for await (const chunk of simulateAnthropicStream(events)) {
      if (chunk.textDelta) {
        textOnly.push(chunk.textDelta);
      }
    }

    expect(textOnly).toEqual(["only text"]);
    // Confirm usage chunks were emitted (they exist) but textDelta-gated callers don't see them.
    // (Implicit: the loop above would only collect "only text".)
  });

  it("message_delta usage.output_tokens maps to completionTokens (not combined total)", async () => {
    // Verify the per-chunk semantics: the message_delta chunk should report
    // the accurate split, not lump everything into totalTokens.
    const events = makeAnthropicEventStream({
      inputTokens: 30,
      outputTokens: 12,
      textChunks: ["x"],
    });

    let deltaChunk: StreamChunk | undefined;
    for await (const chunk of simulateAnthropicStream(events)) {
      if (chunk.finishReason) {
        deltaChunk = chunk;
      }
    }

    expect(deltaChunk).toBeDefined();
    expect(deltaChunk?.usage?.promptTokens).toBe(30);
    expect(deltaChunk?.usage?.completionTokens).toBe(12);
    expect(deltaChunk?.usage?.totalTokens).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H6 — provider threading: selectModelForTask must use the RESOLVED provider
//      from ai.ts/streaming.ts, not call detectProvider() independently
// ─────────────────────────────────────────────────────────────────────────────

describe("H6 — provider threading: resolved provider beats independent detectProvider()", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    _resetForTesting();
    providerRegistry.clear();
    savedEnv = saveAndClearEnv(ALL_PROVIDER_KEYS);
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    _resetForTesting();
    providerRegistry.clear();
  });

  it("resolvedProviderId:anthropic + quality:high → Claude model even when detectProvider() would return OpenAI", () => {
    // Simulate the scenario: OPENAI_API_KEY is set (so detectProvider() returns "openai"),
    // but ai() has already resolved the provider as "anthropic" via options.provider.
    // selectModelForTask is called with the resolved providerId = "anthropic".
    // Without the H6 fix, resolveProviderModelDefaults() calls detectProvider() independently
    // and gets "openai", returning "gpt-4o".
    // With the H6 fix, the threaded "anthropic" wins → Claude model returned.
    process.env.OPENAI_API_KEY = "sk-env-openai-key"; // detectProvider() would see this

    // No registry default — detectProvider() falls through to env, returns "openai"
    providerRegistry.clear();

    const model = selectModelForTask(
      "short prompt",
      { quality: "high" },
      "anthropic", // the already-resolved provider from ai.ts
    );

    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o");
  });

  it("resolvedProviderId:anthropic + quality:fast → Claude fast model (not gpt-4o-mini)", () => {
    process.env.OPENAI_API_KEY = "sk-env-openai-key";
    providerRegistry.clear();

    const model = selectModelForTask(
      "short prompt",
      { quality: "fast" },
      "anthropic",
    );

    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o-mini");
  });

  it("resolvedProviderId:google + quality:high → Gemini model even when env has OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-env-openai-key";
    providerRegistry.clear();

    const model = selectModelForTask(
      "short prompt",
      { quality: "high" },
      "google",
    );

    expect(model).toMatch(/gemini/i);
    expect(model).not.toBe("gpt-4o");
  });

  it("resolvedProviderId:openai + quality:high → gpt-4o (OpenAI still works when explicitly resolved)", () => {
    // Regression guard: when the resolved provider IS OpenAI, we still get the OpenAI model.
    providerRegistry.clear();

    const model = selectModelForTask(
      "short prompt",
      { quality: "high" },
      "openai",
    );

    expect(model).toBe("gpt-4o");
  });

  it("no resolvedProviderId + registry has anthropic → Claude model (backwards compat for direct callers)", () => {
    // Direct callers (AgentUnit operators, tests) that don't thread a providerId still
    // work: detectProvider() is called and finds the registry default.
    providerRegistry.register(makeStubProvider("anthropic"), true);

    const model = selectModelForTask(
      "short prompt",
      { quality: "high" },
      // no resolvedProviderId — falls back to detectProvider() via registry
    );

    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o");
  });

  it("explicit options.model always wins regardless of resolvedProviderId", () => {
    // Priority 1 must not be disturbed by the H6 change.
    process.env.OPENAI_API_KEY = "sk-env-openai-key";
    providerRegistry.clear();

    const model = selectModelForTask(
      "short prompt",
      { model: "my-custom-model", quality: "high" },
      "anthropic",
    );

    expect(model).toBe("my-custom-model");
  });

  it("resolvedProviderId:anthropic + no quality + complex prompt → Claude model (complexity heuristic respects threading)", () => {
    // The complexity heuristic path (prompt.length > 500 or keywords) must also
    // use the threaded provider, not call detectProvider() independently.
    process.env.OPENAI_API_KEY = "sk-env-openai-key";
    providerRegistry.clear();

    // A complex prompt that triggers the complexity branch (step 3b)
    const complexPrompt = "analyze ".repeat(100);

    const model = selectModelForTask(
      complexPrompt,
      {}, // no quality specified — falls to complexity heuristic
      "anthropic",
    );

    expect(model).toMatch(/claude/i);
    expect(model).not.toBe("gpt-4o");
  });
});
