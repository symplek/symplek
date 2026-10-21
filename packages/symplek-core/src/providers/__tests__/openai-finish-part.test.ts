/**
 * @module providers/__tests__/openai-finish-part — Wave 5 REVISE fix: split-chunk FinishPart
 * @description
 *   Pins the behaviour fixed by the Wave 5 REVISE finding:
 *     "medium | typed streaming | openai.ts:301"
 *   OpenAI sends finish_reason and usage in separate streaming chunks. Before the
 *   fix, FinishPart was only emitted when both arrived in the same chunk, meaning
 *   consumers waited forever in the common split-chunk case.
 *
 *   Uses a simulated streamParts() replica (H5 pattern) to test without the SDK.
 *   IMPORTANT: Must stay in sync with the streamParts() logic in openai.ts.
 */

import { describe, expect, it } from "vitest";
import type { FinishPart, StreamPart, ToolCallPart } from "../interface";

// ─── OpenAI chunk shape (subset used in streamParts) ─────────────────────────

interface OAIChunk {
  choices: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

// ─── Replica of openai.ts streamParts() logic ─────────────────────────────────
// Must mirror the post-fix implementation in openai.ts.

function transformFinishReason(
  reason: string | null | undefined,
): FinishPart["finishReason"] {
  switch (reason) {
    case "stop":           return "stop";
    case "length":         return "length";
    case "content_filter": return "content_filter";
    case "tool_calls":     return "tool_calls";
    default:               return "other";
  }
}

async function* simulateOpenAIStreamParts(
  chunks: OAIChunk[],
  aborted = false,
): AsyncIterable<StreamPart> {
  const toolBuffers = new Map<number, { id: string; name: string; argsJson: string }>();
  let pendingFinishReason: string | null = null;
  let pendingUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

  for (const chunk of chunks) {
    if (aborted) return;

    const choice = chunk.choices[0];
    const delta = choice?.delta;

    if (delta?.content) {
      yield { type: "text-delta", textDelta: delta.content };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        const buf = toolBuffers.get(idx);
        if (!buf) {
          toolBuffers.set(idx, {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            argsJson: tc.function?.arguments ?? "",
          });
        } else {
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.argsJson += tc.function.arguments;
        }
      }
    }

    if (choice?.finish_reason) {
      pendingFinishReason = choice.finish_reason;
      if (pendingFinishReason === "tool_calls") {
        for (const buf of toolBuffers.values()) {
          let input: unknown;
          try { input = JSON.parse(buf.argsJson || "{}"); } catch { input = buf.argsJson; }
          yield {
            type: "tool-call",
            toolCallId: buf.id,
            toolName: buf.name,
            input,
          } satisfies ToolCallPart;
        }
        toolBuffers.clear();
      }
    }

    if (chunk.usage) {
      pendingUsage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }

    if (pendingFinishReason !== null && pendingUsage !== null) {
      yield {
        type: "finish",
        finishReason: transformFinishReason(pendingFinishReason),
        usage: pendingUsage,
      } satisfies FinishPart;
      pendingFinishReason = null;
      pendingUsage = null;
    }
  }

  // Failsafe: emit FinishPart if finish_reason arrived but usage never did
  if (pendingFinishReason !== null) {
    yield {
      type: "finish",
      finishReason: transformFinishReason(pendingFinishReason),
      usage: pendingUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } satisfies FinishPart;
  }
}

// ─── OLD (pre-fix) replica — documents the broken behaviour ──────────────────
// This replica mirrors the ORIGINAL logic that only emits FinishPart when both
// finish_reason and usage arrive in the SAME chunk.

async function* simulateOpenAIStreamPartsOld(
  chunks: OAIChunk[],
): AsyncIterable<StreamPart> {
  const toolBuffers = new Map<number, { id: string; name: string; argsJson: string }>();

  for (const chunk of chunks) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;

    if (delta?.content) {
      yield { type: "text-delta", textDelta: delta.content };
    }

    if (choice?.finish_reason === "tool_calls") {
      for (const buf of toolBuffers.values()) {
        let input: unknown;
        try { input = JSON.parse(buf.argsJson || "{}"); } catch { input = buf.argsJson; }
        yield {
          type: "tool-call",
          toolCallId: buf.id,
          toolName: buf.name,
          input,
        } satisfies ToolCallPart;
      }
      toolBuffers.clear();
    }

    // OLD BUG: only emits FinishPart when usage and finish_reason are in the same chunk
    if (chunk.usage) {
      const usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
      if (choice?.finish_reason) {
        yield {
          type: "finish",
          finishReason: transformFinishReason(choice.finish_reason),
          usage,
        } satisfies FinishPart;
      }
    }
  }
}

// ─── Chunk fixtures ────────────────────────────────────────────────────────────

/** Standard OpenAI split-chunk sequence: finish_reason and usage in separate chunks */
function splitChunkSequence(): OAIChunk[] {
  return [
    // Content chunk
    { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
    // Finish chunk (no usage here — this is the split)
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    // Usage chunk (empty choices — this is the second half of the split)
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ];
}

/** Combined chunk (finish_reason and usage together — regression guard) */
function combinedChunkSequence(): OAIChunk[] {
  return [
    { choices: [{ delta: { content: "hello" } }] },
    {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ];
}

// ─── Pre-fix behaviour proof ──────────────────────────────────────────────────

describe("OpenAI streamParts — PRE-FIX behaviour (documents the bug)", () => {
  it("split-chunk: old logic emits ZERO FinishParts (the bug)", async () => {
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamPartsOld(splitChunkSequence())) {
      parts.push(p);
    }
    const finishParts = parts.filter((p) => p.type === "finish");
    // PRE-FIX: finish_reason arrives without usage → condition never true → 0 FinishParts
    expect(finishParts).toHaveLength(0); // documents the bug
  });
});

// ─── Post-fix behaviour ────────────────────────────────────────────────────────

describe("OpenAI streamParts — split-chunk FinishPart (post-fix)", () => {
  it("split-chunk: exactly one FinishPart is emitted with correct usage", async () => {
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(splitChunkSequence())) {
      parts.push(p);
    }

    const finishParts = parts.filter((p): p is FinishPart => p.type === "finish");
    expect(finishParts).toHaveLength(1);
    expect(finishParts[0].finishReason).toBe("stop");
    expect(finishParts[0].usage.promptTokens).toBe(10);
    expect(finishParts[0].usage.completionTokens).toBe(5);
    expect(finishParts[0].usage.totalTokens).toBe(15);
  });

  it("split-chunk: text-delta is emitted before FinishPart", async () => {
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(splitChunkSequence())) {
      parts.push(p);
    }
    const types = parts.map((p) => p.type);
    const finishIdx = types.indexOf("finish");
    const textIdx = types.indexOf("text-delta");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeGreaterThan(textIdx);
  });

  it("combined-chunk (regression): still emits exactly one FinishPart", async () => {
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(combinedChunkSequence())) {
      parts.push(p);
    }
    const finishParts = parts.filter((p): p is FinishPart => p.type === "finish");
    expect(finishParts).toHaveLength(1);
    expect(finishParts[0].finishReason).toBe("stop");
    expect(finishParts[0].usage.totalTokens).toBe(15);
  });

  it("failsafe: emits FinishPart even when usage chunk never arrives", async () => {
    const noUsageChunks: OAIChunk[] = [
      { choices: [{ delta: { content: "hi" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      // no trailing usage chunk
    ];
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(noUsageChunks)) {
      parts.push(p);
    }
    const finishParts = parts.filter((p): p is FinishPart => p.type === "finish");
    expect(finishParts).toHaveLength(1);
    expect(finishParts[0].finishReason).toBe("stop");
    // usage is zeroed when unavailable
    expect(finishParts[0].usage.promptTokens).toBe(0);
  });

  it("tool_calls: tool-call parts emitted before FinishPart even with split usage chunk", async () => {
    const toolCallChunks: OAIChunk[] = [
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "myTool", arguments: '{"x":1}' } }] },
          finish_reason: null,
        }],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      // usage arrives separately
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
    ];

    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(toolCallChunks)) {
      parts.push(p);
    }

    const types = parts.map((p) => p.type);
    const toolCallIdx = types.indexOf("tool-call");
    const finishIdx = types.indexOf("finish");

    expect(toolCallIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeGreaterThan(toolCallIdx); // tool-call before finish

    const finishPart = parts.find((p): p is FinishPart => p.type === "finish");
    expect(finishPart?.finishReason).toBe("tool_calls");
    expect(finishPart?.usage.totalTokens).toBe(8);

    const toolCallPart = parts.find((p): p is ToolCallPart => p.type === "tool-call");
    expect(toolCallPart?.toolName).toBe("myTool");
  });

  it("abort: no FinishPart emitted when aborted before start", async () => {
    const parts: StreamPart[] = [];
    for await (const p of simulateOpenAIStreamParts(splitChunkSequence(), true)) {
      parts.push(p);
    }
    expect(parts.filter((p) => p.type === "finish")).toHaveLength(0);
  });
});
