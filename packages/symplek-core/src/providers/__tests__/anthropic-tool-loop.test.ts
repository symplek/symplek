/**
 * @module providers/__tests__/anthropic-tool-loop — Finding 1 HIGH repair tests
 * @description
 *   Pins the fix for finding:
 *     "high | Anthropic tool loop | anthropic.ts:165"
 *
 *   The Anthropic adapter serialised assistant turns carrying tool calls as a
 *   plain text message, discarding AIMessage.toolCalls entirely. Subsequent
 *   tool_result blocks therefore referenced a tool_use_id that Anthropic had
 *   never seen, causing every multi-turn tool exchange to be rejected.
 *
 *   Fix: transformAnthropicMessages emits tool_use content blocks for
 *   assistant messages whose toolCalls array is populated, giving each
 *   tool_result a tool_use block to correlate against.
 *
 *   PRE-FIX: `transformAnthropicMessages` is not exported from anthropic.ts —
 *   this file fails to import and ALL tests below are counted as failures.
 *   Post-fix: the function is exported, tests execute and pass.
 *
 *   Tests are structured so each assertion FAILS against pre-fix code.
 */

import { describe, expect, it } from "vitest";
// PRE-FIX FAILURE: transformAnthropicMessages is not exported → compile-time
// error → all tests in this file fail with "does not provide an export".
import { transformAnthropicMessages } from "../anthropic";

// ─── 1. Basic tool_use block emission ─────────────────────────────────────────

describe("transformAnthropicMessages — tool_use blocks (Finding 1 HIGH)", () => {
  it("assistant message with toolCalls produces tool_use content block", () => {
    // PRE-FIX: content is emitted as a plain string ("") and toolCalls is
    // discarded. Array.isArray("") === false → assertion fails.
    const { messages } = transformAnthropicMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "myTool", input: { x: 1 } }],
      },
    ]);

    const asstMsg = messages[0]!;
    expect(asstMsg.role).toBe("assistant");
    expect(Array.isArray(asstMsg.content)).toBe(true);

    const blocks = asstMsg.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    const toolUseBlock = blocks.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock!.id).toBe("tc1");
    expect(toolUseBlock!.name).toBe("myTool");
    expect(toolUseBlock!.input).toEqual({ x: 1 });
  });

  it("assistant message with text AND toolCalls emits both text and tool_use blocks", () => {
    const { messages } = transformAnthropicMessages([
      {
        role: "assistant",
        content: "Let me calculate that.",
        toolCalls: [{ id: "tc2", name: "calc", input: {} }],
      },
    ]);

    const asstMsg = messages[0]!;
    const blocks = asstMsg.content as Array<{ type: string; text?: string }>;

    const textBlock = blocks.find((b) => b.type === "text");
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toBe("Let me calculate that.");

    const toolUseBlock = blocks.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toBeDefined();
  });

  it("assistant message without toolCalls emits string content (no regression)", () => {
    const { messages } = transformAnthropicMessages([
      { role: "assistant", content: "The answer is 42." },
    ]);

    const asstMsg = messages[0]!;
    expect(asstMsg.role).toBe("assistant");
    // No tool calls: content stays as a string (Anthropic accepts both forms)
    expect(typeof asstMsg.content).toBe("string");
    expect(asstMsg.content).toBe("The answer is 42.");
  });
});

// ─── 2. Full multi-turn exchange body shape ───────────────────────────────────
//
// Asserts the complete request body for a call → result → follow-up exchange.
// This is the shape the Anthropic API requires: tool_use in the assistant turn,
// tool_result (as role:user content block) in the next turn.
//
// PRE-FIX: messages[1].content is a plain string → array assertions fail.

describe("transformAnthropicMessages — full multi-turn exchange body shape", () => {
  it("correctly serialises a three-message call → result → follow-up exchange", () => {
    // Simulate the message history after executeLoop appends an assistant message
    // with toolCalls and a tool-result message.
    const { messages } = transformAnthropicMessages([
      { role: "user", content: "What is 6 * 7?" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "calculator", input: { expression: "6 * 7" } }],
      },
      { role: "tool", content: "42", toolCallId: "c1" },
    ]);

    expect(messages).toHaveLength(3);

    // user turn: plain string
    const userMsg = messages[0]!;
    expect(userMsg.role).toBe("user");
    expect(typeof userMsg.content).toBe("string");

    // assistant turn: array with a tool_use block
    const asstMsg = messages[1]!;
    expect(asstMsg.role).toBe("assistant");
    expect(Array.isArray(asstMsg.content)).toBe(true);
    const asstBlocks = asstMsg.content as Array<{ type: string; id?: string; name?: string }>;
    const toolUseBlock = asstBlocks.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toBeDefined();
    expect(toolUseBlock!.id).toBe("c1");
    expect(toolUseBlock!.name).toBe("calculator");

    // tool result turn: role:user with a tool_result content block correlated by tool_use_id
    const toolResultMsg = messages[2]!;
    expect(toolResultMsg.role).toBe("user");
    expect(Array.isArray(toolResultMsg.content)).toBe(true);
    const resultBlocks = toolResultMsg.content as Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
    }>;
    const toolResultBlock = resultBlocks.find((b) => b.type === "tool_result");
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock!.tool_use_id).toBe("c1");
    expect(toolResultBlock!.content).toBe("42");
  });

  it("system messages are extracted and assistant/user messages are preserved", () => {
    const { system, messages } = transformAnthropicMessages([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there." },
    ]);

    expect(system).toBe("You are a helpful assistant.");
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
  });
});
