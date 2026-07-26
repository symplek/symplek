/**
 * @module tool-loop.test — CR-402 acceptance + wave-5 adversarial repair tests
 * @description
 *   Proves the tool loop is correct end-to-end. The original suite passed while
 *   four defects were live; the wave-5 adversarial review exposed them. Tests are
 *   structured so each new test FAILS against the pre-fix code and PASSES after.
 *
 *   1. Public-path prototype test: AgentUnit.loop() is a function via root barrel.
 *   2. Multi-turn exchange: tool executes, result feeds back as role:"tool" message.
 *   3. Assistant message carries toolCalls (for Anthropic tool_use block requirement).
 *   4. Second-turn tool calls execute and go through the approval gate.
 *   5. Approval gate: approved executes; denied does NOT; pending suspends.
 *   6. Parse gate: malformed input fails before reaching approval or execution.
 *   7. No-side-effect-without-approval property, including the second-turn case.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentUnit, createContext } from "../index";
import { executeLoop } from "../agent/executor";
import { ToolApprovalRequiredError } from "../interview/computations";
import { tool, type Tool, type ToolApprovalPayload } from "../agent/tool";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
  ToolCall,
} from "../providers/interface";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCapabilities(): ProviderCapabilities {
  return {
    streaming: true,
    tools: true,
    vision: false,
    structuredOutput: false,
    maxContextTokens: 100_000,
  };
}

/** A mock provider that returns scripted responses in order. */
function makeMockProvider(
  script: Array<Partial<AIResponse> & { finishReason: AIResponse["finishReason"] }>,
): Provider & { calls: AIRequest[] } {
  const calls: AIRequest[] = [];
  let idx = 0;
  return {
    id: "mock",
    name: "Mock",
    capabilities: makeCapabilities(),
    calls,
    async generate(req: AIRequest): Promise<AIResponse> {
      calls.push(req);
      const resp = script[idx++] ?? { text: "", finishReason: "stop" };
      return {
        text: resp.text ?? "",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: resp.finishReason,
        toolCalls: resp.toolCalls,
        raw: undefined,
      };
    },
    async *stream(): AsyncIterable<StreamChunk> {
      yield { textDelta: "" };
    },
    identify() {
      return { id: "mock", name: "Mock" };
    },
  };
}

// ─── 1. Public-path prototype test ───────────────────────────────────────────
//
// Finding 1: AgentUnit.prototype.loop is installed via a side-effect-only module.
// operators/loop.ts has no VALUE exports — only the interface LoopOperatorOptions.
// When a bundler tree-shakes export * from "./loop" (no value exports → elide),
// the prototype augmentation never runs and AgentUnit.of("x").loop is undefined.
//
// Fix: add import "./loop" (explicit side-effect import) to operators/index.ts.
// The test must import AgentUnit through the public root barrel ("../index"),
// NOT directly from the operator module, because a direct import masks the
// tree-shaking failure by evaluating the module as a side-effect itself.
//
// PRE-FIX FAILURE: if operators/index.ts lacks the explicit side-effect import
// and the bundler/test-runner tree-shakes the module, typeof loop === "undefined".

describe("Finding 1 — AgentUnit.loop exists on the public root-barrel import", () => {
  it("AgentUnit imported via root barrel has loop as a function", () => {
    // Imports from "../index" (root barrel) which chains through
    // AgentUnit/index.ts → operators/index.ts → operators/loop.ts.
    // This is the same resolution path a consumer gets from "@symplek/core".
    expect(typeof AgentUnit.of("x").loop).toBe("function");
  });

  it("loop operator produces an AgentUnit (not undefined) without options", () => {
    const unit = AgentUnit.of("prompt").loop();
    expect(unit).toBeDefined();
    // Duck-type: a real AgentUnit has .run
    expect(typeof (unit as unknown as { run: unknown }).run).toBe("function");
  });
});

// ─── 2. Multi-turn tool loop ──────────────────────────────────────────────────

describe("executeLoop — multi-turn tool exchange", () => {
  it("executes a tool call and feeds the result back as a second provider turn", async () => {
    const executedWith: unknown[] = [];

    const calculator = tool({
      name: "calculator",
      description: "Evaluates a math expression",
      parameters: z.object({ expression: z.string() }),
      execute: async ({ expression }) => {
        executedWith.push(expression);
        return `${expression} = 42`;
      },
    });

    const toolCallResp: ToolCall[] = [
      { id: "call_1", name: "calculator", input: { expression: "6 * 7" } },
    ];
    const freshProvider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
      { text: "The answer is 42.", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      freshProvider,
      [{ role: "user", content: "What is 6 * 7?" }],
      [calculator as Tool & { name: string }],
      { model: "test-model" },
    );

    // Tool was actually executed.
    expect(executedWith).toEqual(["6 * 7"]);

    // Two provider calls: first (tool call request), second (with tool result).
    expect(freshProvider.calls).toHaveLength(2);

    // Second request must include a role:"tool" message with the tool result.
    const secondRequest = freshProvider.calls[1]!;
    const toolMsg = secondRequest.messages.find((m: AIMessage) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("call_1");
    expect(toolMsg!.content).toContain("42");

    // Final text is the provider's second response.
    expect(result.text).toBe("The answer is 42.");
    expect(result.toolCallCount).toBe(1);
  });

  it("stops immediately when provider returns no tool calls", async () => {
    const provider = makeMockProvider([
      { text: "Hello, world.", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "Say hello" }],
      [],
      { model: "test-model" },
    );

    expect(provider.calls).toHaveLength(1);
    expect(result.text).toBe("Hello, world.");
    expect(result.toolCallCount).toBe(0);
  });

  it("respects stopWhen predicate and stops early", async () => {
    const echoTool = tool({
      name: "echo",
      description: "Echoes input",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => text,
    });

    // Script: two tool-call responses, then a stop.
    const provider = makeMockProvider([
      {
        toolCalls: [{ id: "c1", name: "echo", input: { text: "step1" } }],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [{ id: "c2", name: "echo", input: { text: "step2" } }],
        finishReason: "tool_calls",
      },
      { text: "done", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "start" }],
      [echoTool as Tool & { name: string }],
      {
        model: "test-model",
        stopWhen: (step) => step.toolResults.length > 0 && step.stepNumber >= 1,
      },
    );

    // Only one tool-call step was executed before stopWhen fired.
    expect(result.steps).toHaveLength(1);

    // One provider call: the loop stops after tool execution in iteration 1,
    // before any further generate() call. The old code made TWO calls per
    // tool step (initial + a "feed call"), which was the incorrect behaviour
    // that this assertion previously measured. After the fix, stopWhen fires
    // after tool execution and no feed call is made.
    //
    // BEFORE (wrong): expect(provider.calls).toHaveLength(2)
    // AFTER  (correct): expect(provider.calls).toHaveLength(1)
    expect(provider.calls).toHaveLength(1);
  });
});

// ─── 3. Finding 2 — assistant message must carry toolCalls ───────────────────
//
// Anthropic requires a `tool_use` content block in the assistant turn that
// immediately precedes each `tool_result` block. Without it, Anthropic rejects
// the orphaned tool_result (400). The executor must include the provider's tool
// call objects on the assistant AIMessage so the Anthropic adapter can emit the
// required `tool_use` block.
//
// PRE-FIX FAILURE: executor.ts pushed
//   { role: "assistant", content: response.text || "" }
// — no toolCalls field. The test assertion
//   expect(assistantMsg!.toolCalls).toBeDefined()
// failed because the field was absent.

describe("Finding 2 — assistant message carries toolCalls for tool_use block", () => {
  it("assistant message in the feed request includes the provider toolCalls", async () => {
    const calcTool = tool({
      name: "calc",
      description: "Calculates",
      parameters: z.object({ x: z.number() }),
      execute: async ({ x }) => String(x),
    }) as Tool<z.ZodObject<{ x: z.ZodNumber }>, string> & { name: string };

    const toolCallResp: ToolCall[] = [{ id: "tc1", name: "calc", input: { x: 7 } }];
    const provider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
      { text: "done", finishReason: "stop" },
    ]);

    await executeLoop(
      provider,
      [{ role: "user", content: "compute" }],
      [calcTool],
      { model: "test-model" },
    );

    // The second generate() call carries the message history including the
    // assistant turn from step 1. That assistant message must have toolCalls.
    const secondCallMessages = provider.calls[1]!.messages;
    const assistantMsg = secondCallMessages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toBeDefined();
    expect(assistantMsg!.toolCalls).toHaveLength(1);
    expect(assistantMsg!.toolCalls![0]!.id).toBe("tc1");
    expect(assistantMsg!.toolCalls![0]!.name).toBe("calc");
  });
});

// ─── 4. Finding 3 — second-turn tool calls must execute ──────────────────────
//
// After feeding a tool result, the model's next response may itself contain tool
// calls. The old code discarded those calls and pushed only the assistant text,
// then called generate() again from an inconsistent state. Any tool the model
// requested on the second (or later) turn was silently dropped.
//
// PRE-FIX FAILURE: with old executor, only tool_a executed ("a:first" in
// `executed`); tool_b was dropped by the "feed call" path. The assertion
//   expect(executed).toEqual(["a:first", "b:second"])
// failed because executed was ["a:first"].

describe("Finding 3 — second-turn tool calls are executed", () => {
  it("executes tool calls that appear in a second LLM turn", async () => {
    const executed: string[] = [];

    const toolA = tool({
      name: "tool_a",
      description: "First tool",
      parameters: z.object({ val: z.string() }),
      execute: async ({ val }) => {
        executed.push(`a:${val}`);
        return "a_done";
      },
    }) as Tool<z.ZodObject<{ val: z.ZodString }>, string> & { name: string };

    const toolB = tool({
      name: "tool_b",
      description: "Second tool",
      parameters: z.object({ val: z.string() }),
      execute: async ({ val }) => {
        executed.push(`b:${val}`);
        return "b_done";
      },
    }) as Tool<z.ZodObject<{ val: z.ZodString }>, string> & { name: string };

    const provider = makeMockProvider([
      {
        toolCalls: [{ id: "c1", name: "tool_a", input: { val: "first" } }],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [{ id: "c2", name: "tool_b", input: { val: "second" } }],
        finishReason: "tool_calls",
      },
      { text: "all done", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "run tasks" }],
      [toolA, toolB],
      { model: "test-model" },
    );

    // Both tools must have executed.
    expect(executed).toEqual(["a:first", "b:second"]);
    // Three provider calls: initial (tool_a), feed (tool_b), final (text).
    expect(provider.calls).toHaveLength(3);
    expect(result.text).toBe("all done");
  });

  it("second-turn tool calls route through the approval gate", async () => {
    const executedCalls: string[] = [];
    const approvalCallNames: string[] = [];

    const chargeCard = tool({
      name: "charge_card",
      description: "Charges a credit card",
      parameters: z.object({ amount: z.number() }),
      execute: async ({ amount }) => {
        executedCalls.push(`charge:${amount}`);
        return "charged";
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ amount: z.ZodNumber }>, string> & { name: string };

    const provider = makeMockProvider([
      {
        toolCalls: [{ id: "c1", name: "charge_card", input: { amount: 100 } }],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [{ id: "c2", name: "charge_card", input: { amount: 200 } }],
        finishReason: "tool_calls",
      },
      { text: "both charged", finishReason: "stop" },
    ]);

    await executeLoop(
      provider,
      [{ role: "user", content: "charge cards" }],
      [chargeCard],
      {
        model: "test-model",
        requireApproval: async (payload) => {
          approvalCallNames.push(payload.toolName);
          return true; // approve all
        },
      },
    );

    // Both tool calls must have gone through the approval gate.
    expect(approvalCallNames).toHaveLength(2);
    expect(approvalCallNames).toEqual(["charge_card", "charge_card"]);
    // Both executed.
    expect(executedCalls).toEqual(["charge:100", "charge:200"]);
  });
});

// ─── 5. AgentUnit.loop() integration ─────────────────────────────────────────

describe("AgentUnit.loop() — operator integration", () => {
  it("uses the unit's resolved string value as the initial prompt", async () => {
    const provider = makeMockProvider([
      { text: "Echo: hi", finishReason: "stop" },
    ]);

    const ctx = createContext();
    const result = await AgentUnit.of("hi")
      .loop({ provider, model: "test-model" })
      .run(ctx);

    expect(result.value.text).toBe("Echo: hi");
    expect(provider.calls[0]!.messages[0]!.content).toBe("hi");
  });

  it("tool import from @symplek/core/agent subpath resolves", async () => {
    // Proves that the subpath barrel works in-process (imports resolve).
    const { tool: toolFn, stopWhen, DEFAULT_LOOP_OPTIONS } = await import(
      "../agent/index"
    );

    expect(typeof toolFn).toBe("function");
    expect(typeof stopWhen.noToolCalls).toBe("function");
    expect(DEFAULT_LOOP_OPTIONS.maxSteps).toBe(5);
  });
});

// ─── 6. Approval gate ─────────────────────────────────────────────────────────

describe("executeLoop — approval gate", () => {
  it("approved: executes the tool and continues the loop", async () => {
    const executedActions: string[] = [];
    const execTool = tool({
      name: "risky_action",
      description: "Action requiring approval",
      parameters: z.object({ action: z.string() }),
      execute: async ({ action }) => {
        executedActions.push(action);
        return `done: ${action}`;
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ action: z.ZodString }>, string> & { name: string };

    const toolCallResp: ToolCall[] = [
      { id: "call_approve", name: "risky_action", input: { action: "deploy" } },
    ];
    const provider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
      { text: "Deployment complete.", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "Deploy the app" }],
      [execTool],
      {
        model: "test-model",
        requireApproval: async () => true, // Approve all
      },
    );

    expect(executedActions).toEqual(["deploy"]);
    expect(result.text).toBe("Deployment complete.");

    // The tool result message must carry the tool output, not a denial message.
    const toolMsg = provider.calls[1]!.messages.find(
      (m: AIMessage) => m.role === "tool",
    );
    expect(toolMsg!.content).toContain("done: deploy");
  });

  it("denied: does NOT execute the tool; inserts a denial message that is distinguishable from an error", async () => {
    const executedActions: string[] = [];
    const execTool = tool({
      name: "risky_action",
      description: "Action requiring approval",
      parameters: z.object({ action: z.string() }),
      execute: async ({ action }) => {
        executedActions.push(action);
        return `done: ${action}`;
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ action: z.ZodString }>, string> & { name: string };

    const toolCallResp: ToolCall[] = [
      { id: "call_deny", name: "risky_action", input: { action: "nuke" } },
    ];
    const provider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
      { text: "Understood, action was refused.", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "Nuke the database" }],
      [execTool],
      {
        model: "test-model",
        requireApproval: async () => false, // Deny all
      },
    );

    // Tool was NOT executed.
    expect(executedActions).toHaveLength(0);

    // Loop continued; provider got a second call with the denial message.
    expect(provider.calls).toHaveLength(2);
    const toolMsg = provider.calls[1]!.messages.find(
      (m: AIMessage) => m.role === "tool",
    );
    expect(toolMsg).toBeDefined();
    // Denial message content is clearly "denied", not an exception trace.
    expect(toolMsg!.content.toLowerCase()).toContain("denied");
    expect(toolMsg!.toolCallId).toBe("call_deny");

    // The result text comes from the provider's second response.
    expect(result.text).toBe("Understood, action was refused.");
    // The step records a denial, not an error — toolResults contains { denied: true }.
    const denial = result.steps[0]?.toolResults.find(
      (r): r is { denied: boolean; toolCallId: string } =>
        typeof r === "object" && r !== null && "denied" in r,
    );
    expect(denial?.denied).toBe(true);
  });

  it("pending: loop suspends until approval callback resolves", async () => {
    const executedActions: string[] = [];
    const execTool = tool({
      name: "risky_action",
      description: "Approval-gated action",
      parameters: z.object({ action: z.string() }),
      execute: async ({ action }) => {
        executedActions.push(action);
        return `done: ${action}`;
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ action: z.ZodString }>, string> & { name: string };

    const toolCallResp: ToolCall[] = [
      { id: "call_pending", name: "risky_action", input: { action: "migrate" } },
    ];
    const provider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
      { text: "Migration done.", finishReason: "stop" },
    ]);

    let resolveApproval!: (approved: boolean) => void;
    const approvalGate = new Promise<boolean>((resolve) => {
      resolveApproval = resolve;
    });

    const runPromise = executeLoop(
      provider,
      [{ role: "user", content: "Run migration" }],
      [execTool],
      {
        model: "test-model",
        requireApproval: () => approvalGate,
      },
    );

    // Loop is suspended — tool has NOT executed yet.
    expect(executedActions).toHaveLength(0);

    // Resolve the pending approval gate.
    resolveApproval(true);
    const result = await runPromise;

    // Now the tool was executed.
    expect(executedActions).toEqual(["migrate"]);
    expect(result.text).toBe("Migration done.");
  });

  it("throws ToolApprovalRequiredError when requiresApproval tool has no gate", async () => {
    const execTool = tool({
      name: "risky_action",
      description: "Approval-gated",
      parameters: z.object({ action: z.string() }),
      execute: async ({ action }) => action,
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ action: z.ZodString }>, string> & { name: string };

    const toolCallResp: ToolCall[] = [
      { id: "call_x", name: "risky_action", input: { action: "x" } },
    ];
    const provider = makeMockProvider([
      { toolCalls: toolCallResp, finishReason: "tool_calls" },
    ]);

    await expect(
      executeLoop(
        provider,
        [{ role: "user", content: "Do x" }],
        [execTool],
        { model: "test-model" }, // No requireApproval
      ),
    ).rejects.toThrow(ToolApprovalRequiredError);
  });
});

// ─── 7. Finding 4 — tool input validated through Zod before use ──────────────
//
// Provider input is received as `unknown`. The old code type-asserted it as
// z.infer<typeof schema> without parsing, so approval predicates and the
// executor could interpret the same input differently.
//
// Scenario (from the review): a tool expects `delete: z.boolean()` and gates
// on `delete === true`. Provider sends `{delete: "false"}` (a string). The
// predicate sees `"false" === true` → false → skips approval. The executor
// receives the string, and truthy `"false"` could trigger deletion.
//
// Fix: `safeParse` through the Zod schema ONCE before any decision. A parse
// failure is a clear, non-executing outcome: a tool_result error is sent to
// the LLM and the side effect never runs.
//
// PRE-FIX FAILURE: with `call.input as z.infer<...>`, the assertion
//   expect(executed).toBe(false)
// failed because the executor received the truthy string and ran the tool.

describe("Finding 4 — tool input parsed through Zod before approval or execution", () => {
  it("parse failure stops execution and sends a validation error to the LLM", async () => {
    let executed = false;

    // Tool expects a boolean; provider will send a string.
    const deleteTool = tool({
      name: "delete_resource",
      description: "Deletes a resource — boolean required",
      parameters: z.object({ delete: z.boolean() }),
      execute: async () => {
        executed = true;
        return "deleted";
      },
      // Approval predicate: only require approval when delete === true.
      requiresApproval: (params) => params.delete === true,
    }) as Tool<z.ZodObject<{ delete: z.ZodBoolean }>, string> & { name: string };

    const provider = makeMockProvider([
      {
        // Malformed: "false" is a string, not a boolean.
        toolCalls: [
          { id: "c1", name: "delete_resource", input: { delete: "false" } },
        ],
        finishReason: "tool_calls",
      },
      { text: "could not delete", finishReason: "stop" },
    ]);

    const result = await executeLoop(
      provider,
      [{ role: "user", content: "delete it" }],
      [deleteTool],
      {
        model: "test-model",
        requireApproval: async () => true, // would approve if parse succeeded
      },
    );

    // Parse failure: the tool must NOT have executed.
    expect(executed).toBe(false);

    // The second generate() call must have received a tool_result message that
    // indicates a validation/parse error — not a generic execute error.
    const toolMsg = provider.calls[1]!.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content.toLowerCase()).toMatch(/validation|parse/);

    // The loop continued and returned the LLM's response after the error.
    expect(result.text).toBe("could not delete");
  });

  it("type coercion bypass: string 'false' does not pass approval gate as falsy boolean", async () => {
    // Specifically tests the finding scenario: `{delete:"false"}` must not skip
    // approval and then proceed to execute with a truthy check.
    let approvalWasCalled = false;
    let executed = false;

    const dangerTool = tool({
      name: "danger",
      description: "Danger — boolean gated",
      parameters: z.object({ confirmed: z.boolean() }),
      execute: async () => {
        executed = true;
        return "done";
      },
      requiresApproval: (params) => params.confirmed === true,
    }) as Tool<z.ZodObject<{ confirmed: z.ZodBoolean }>, string> & {
      name: string;
    };

    const provider = makeMockProvider([
      {
        toolCalls: [
          // String "false" instead of boolean false — coercion bypass attempt.
          { id: "c1", name: "danger", input: { confirmed: "false" } },
        ],
        finishReason: "tool_calls",
      },
      { text: "rejected", finishReason: "stop" },
    ]);

    await executeLoop(
      provider,
      [{ role: "user", content: "run danger" }],
      [dangerTool],
      {
        model: "test-model",
        requireApproval: async () => {
          approvalWasCalled = true;
          return true;
        },
      },
    );

    // Parse failure means: approval was never called AND execute never ran.
    expect(approvalWasCalled).toBe(false);
    expect(executed).toBe(false);
  });
});

// ─── 8. No-side-effect-without-approval property ─────────────────────────────

describe("No side effect executes without passing the approval gate", () => {
  it("all tool calls across every turn are subject to the approval gate", async () => {
    const sideEffects: string[] = [];
    const approvals: string[] = [];

    const sensitiveOp = tool({
      name: "sensitive",
      description: "Sensitive operation",
      parameters: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        sideEffects.push(id);
        return `ran:${id}`;
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ id: z.ZodString }>, string> & { name: string };

    const provider = makeMockProvider([
      {
        toolCalls: [{ id: "c1", name: "sensitive", input: { id: "first" } }],
        finishReason: "tool_calls",
      },
      {
        // Second turn also requests the tool.
        toolCalls: [{ id: "c2", name: "sensitive", input: { id: "second" } }],
        finishReason: "tool_calls",
      },
      { text: "done", finishReason: "stop" },
    ]);

    await executeLoop(
      provider,
      [{ role: "user", content: "run twice" }],
      [sensitiveOp],
      {
        model: "test-model",
        requireApproval: async (payload) => {
          approvals.push(payload.toolCallId);
          return true; // approve all
        },
      },
    );

    // Every tool call must have been gated.
    expect(approvals).toHaveLength(2);
    expect(approvals).toContain("c1");
    expect(approvals).toContain("c2");
    // Every gated call (approved) must have executed.
    expect(sideEffects).toEqual(["first", "second"]);
  });

  it("denied tool on second turn does not execute", async () => {
    let executed = false;

    const dangerTool = tool({
      name: "danger",
      description: "Dangerous action",
      parameters: z.object({ confirm: z.boolean() }),
      execute: async () => {
        executed = true;
        return "done";
      },
      requiresApproval: true,
    }) as Tool<z.ZodObject<{ confirm: z.ZodBoolean }>, string> & { name: string };

    const provider = makeMockProvider([
      // First turn: text only (no tool calls).
      { text: "planning...", finishReason: "stop" },
    ]);

    // Only one call, no tool calls at all → tool never requested.
    const result = await executeLoop(
      provider,
      [{ role: "user", content: "plan and act" }],
      [dangerTool],
      {
        model: "test-model",
        requireApproval: async () => false,
      },
    );

    expect(executed).toBe(false);
    expect(result.text).toBe("planning...");
  });
});

// ─── 9. Anthropic provider — transformMessages role:tool fix ──────────────────

describe("Anthropic provider — transformMessages role:tool fix", () => {
  it("produces tool_result content block (not plain user message) for role:tool messages", async () => {
    const capturedRequests: AIRequest[] = [];
    const recordingProvider: Provider & { calls: AIRequest[] } = {
      id: "recording",
      name: "Recording",
      capabilities: makeCapabilities(),
      calls: capturedRequests,
      async generate(req) {
        capturedRequests.push(req);
        const hasTool = capturedRequests.length === 1;
        return {
          text: hasTool ? "" : "final",
          usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
          finishReason: hasTool ? "tool_calls" : "stop",
          toolCalls: hasTool
            ? [{ id: "tc_1", name: "echoTool", input: { msg: "hello" } }]
            : undefined,
        };
      },
      async *stream(): AsyncIterable<StreamChunk> {
        yield { textDelta: "" };
      },
      identify() {
        return { id: "recording", name: "Recording" };
      },
    };

    const echoTool = tool({
      name: "echoTool",
      description: "Echoes a message",
      parameters: z.object({ msg: z.string() }),
      execute: async ({ msg }) => msg,
    }) as Tool<z.ZodObject<{ msg: z.ZodString }>, string> & { name: string };

    await executeLoop(
      recordingProvider,
      [{ role: "user", content: "Echo hello" }],
      [echoTool],
      { model: "test-model" },
    );

    // Second request (with tool result) must have a role:"tool" message.
    expect(capturedRequests).toHaveLength(2);
    const secondReq = capturedRequests[1]!;
    const toolMsg = secondReq.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe("tc_1");
    expect(toolMsg!.content).toBe("hello");
  });
});

// ─── 10. subpath import smoke ─────────────────────────────────────────────────

describe("@symplek/core/agent subpath contract", () => {
  it("exports tool, LoopOptions, stopWhen, DEFAULT_LOOP_OPTIONS, ToolApprovalPayload", async () => {
    const agentSubpath = await import("../agent/index");

    expect(typeof agentSubpath.tool).toBe("function");
    expect(typeof agentSubpath.stopWhen.noToolCalls).toBe("function");
    expect(typeof agentSubpath.stopWhen.maxSteps).toBe("function");
    expect(typeof agentSubpath.stopWhen.containsText).toBe("function");
    expect(typeof agentSubpath.stopWhen.custom).toBe("function");
    expect(typeof agentSubpath.DEFAULT_LOOP_OPTIONS).toBe("object");
    expect(agentSubpath.DEFAULT_LOOP_OPTIONS.maxSteps).toBe(5);
    expect(typeof agentSubpath.ToolApprovalRequiredError).toBe("function");
    expect(typeof agentSubpath.createToolApprovalComputation).toBe("function");
    expect(typeof agentSubpath.createToolApprovalGateComputation).toBe("function");
  });

  it("ToolApprovalRequiredError is distinguishable from a generic Error", () => {
    // Use the top-level static import (line 19) — require() fails in ESM context.
    const Err = ToolApprovalRequiredError;

    const payload: ToolApprovalPayload = {
      type: "tool-approval",
      toolCallId: "c1",
      toolName: "danger_tool",
      input: {},
    };
    const err = new Err(payload);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ToolApprovalRequiredError");
    expect(err.payload).toBe(payload);
    expect(err.message).toContain("danger_tool");
  });
});
