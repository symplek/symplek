/**
 * @module providers/__tests__/openai-tool-loop — Finding R3-3 HIGH repair tests
 * @description
 *   Pins the fix for finding:
 *     "high | tool-loop integration | openai.ts:144"
 *
 *   The OpenAI adapter accepted AIRequest.tools in its interface but never forwarded
 *   it to the OpenAI client. Consequently executeLoop() with an OpenAI provider sent
 *   no tool definitions, the model returned plain text, and the tool was never called.
 *   The response side was equally broken: AIMessage.toolCalls were never populated,
 *   so even if the model somehow returned tool_calls the loop could not parse them.
 *
 *   Fix:
 *   - generate(): forward request.tools as OpenAI function tools; parse tool_calls
 *     from the response into AIResponse.toolCalls.
 *   - stream(): forward request.tools.
 *   - streamParts(): forward request.tools.
 *
 *   Exported helpers buildOpenAITools() and parseOpenAIToolCalls() are imported
 *   directly from openai.ts so the tests pin the ACTUAL implementation, not a replica.
 *
 *   PRE-FIX FAILURE: buildOpenAITools and parseOpenAIToolCalls are not exported
 *   from openai.ts — this file fails to import and ALL tests below are counted as
 *   failures.
 *   POST-FIX: the functions are exported and correctly implemented; all tests pass.
 */

import { describe, expect, it } from "vitest";
// PRE-FIX FAILURE: these exports do not exist → module import error → all tests fail.
import { buildOpenAITools, parseOpenAIToolCalls } from "../openai";
import type { ToolDefinition } from "../interface";

// ─── Tool definitions fixture ─────────────────────────────────────────────────

const searchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

const calcTool: ToolDefinition = {
  name: "calculator",
  description: "Evaluate a math expression",
  inputSchema: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
};

// ─── Finding R3-3: tools forwarded in request body ───────────────────────────
//
// PRE-FIX FAILURE: buildOpenAITools() did not exist in openai.ts — the tools
// field was simply not added to the client.chat.completions.create() call body.
// The assertions below fail because the module import fails.

describe("Finding R3-3 — buildOpenAITools(): OpenAI function-tool format", () => {
  it("converts a single ToolDefinition to an OpenAI function-tool entry", () => {
    const result = buildOpenAITools([searchTool]);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0]!.type).toBe("function");
    expect(result![0]!.function.name).toBe("web_search");
    expect(result![0]!.function.description).toBe("Search the web for information");
    expect(result![0]!.function.parameters).toEqual(searchTool.inputSchema);
  });

  it("converts multiple ToolDefinitions preserving order", () => {
    const result = buildOpenAITools([searchTool, calcTool]);

    expect(result).toHaveLength(2);
    expect(result![0]!.function.name).toBe("web_search");
    expect(result![1]!.function.name).toBe("calculator");
  });

  it("returns undefined when tools is undefined (no tools field in request)", () => {
    expect(buildOpenAITools(undefined)).toBeUndefined();
  });

  it("returns undefined when tools is empty (no tools field in request)", () => {
    expect(buildOpenAITools([])).toBeUndefined();
  });

  it("forwards the full inputSchema as the parameters field", () => {
    const complexSchema = {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    };
    const result = buildOpenAITools([{ ...searchTool, inputSchema: complexSchema }]);
    expect(result![0]!.function.parameters).toEqual(complexSchema);
  });
});

// ─── Finding R3-3: response tool_calls parsed into AIResponse ────────────────
//
// PRE-FIX FAILURE: the generate() path never read choice.message.tool_calls,
// so AIResponse.toolCalls was always undefined and executeLoop() never saw tool
// calls from an OpenAI provider.

describe("Finding R3-3 — parseOpenAIToolCalls(): AIResponse.toolCalls population", () => {
  it("parses a single tool call with JSON arguments into ToolCall", () => {
    const raw = [
      {
        id: "call_abc123",
        function: { name: "web_search", arguments: '{"query":"hello world"}' },
      },
    ];

    const result = parseOpenAIToolCalls(raw);

    expect(result).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result![0]!.id).toBe("call_abc123");
    expect(result![0]!.name).toBe("web_search");
    expect(result![0]!.input).toEqual({ query: "hello world" });
  });

  it("parses multiple tool calls preserving all fields", () => {
    const raw = [
      { id: "c1", function: { name: "tool_a", arguments: '{"x":1}' } },
      { id: "c2", function: { name: "tool_b", arguments: '{"y":"text"}' } },
    ];

    const result = parseOpenAIToolCalls(raw);

    expect(result).toHaveLength(2);
    expect(result![0]!.name).toBe("tool_a");
    expect(result![0]!.input).toEqual({ x: 1 });
    expect(result![1]!.name).toBe("tool_b");
    expect(result![1]!.input).toEqual({ y: "text" });
  });

  it("stores raw string when arguments are malformed JSON (no throw)", () => {
    const raw = [
      { id: "c1", function: { name: "broken", arguments: "not-json" } },
    ];

    const result = parseOpenAIToolCalls(raw);

    expect(result![0]!.input).toBe("not-json");
  });

  it("uses empty object when arguments string is empty", () => {
    const raw = [
      { id: "c1", function: { name: "no_args", arguments: "" } },
    ];

    const result = parseOpenAIToolCalls(raw);

    expect(result![0]!.input).toEqual({});
  });

  it("returns undefined for null, undefined, or empty tool_calls", () => {
    expect(parseOpenAIToolCalls(null)).toBeUndefined();
    expect(parseOpenAIToolCalls(undefined)).toBeUndefined();
    expect(parseOpenAIToolCalls([])).toBeUndefined();
  });
});
