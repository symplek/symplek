/**
 * @fileoverview Regression tests for the three B10 rehearsal integrity defects.
 * @description Each test is written to FAIL against the pre-fix code and PASS
 *   after the fix, proving that the fix is load-bearing.
 *
 * Defect 1 (replayer.ts): verifyFinalOutputIntegrity() computed the output hash
 *   then discarded it — tampered finalOutput was never caught.
 * Defect 2 (testing.ts): TestHarness.verify() ran execute() once then replayed
 *   the trace, which trivially returned trace.finalOutput — a non-deterministic
 *   agent could never be detected.
 * Defect 3 (interceptor.ts): RecordingLLMInterceptor omitted response text when
 *   includePrompts=false (default), so extractLLMCalls substituted "" — a replay
 *   with a different response was indistinguishable from the original.
 */

import { describe, expect, it, vi } from "vitest";
import { RecordingLLMInterceptor } from "../interceptor";
import { TraceRecorder } from "../recorder";
import { TraceReplayer } from "../replayer";
import { createTestHarness, DeterminismError } from "../testing";
import type { ExecutionTrace, RehearsalResult } from "../types";
import { TRACE_SCHEMA_VERSION } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** DJB2 — must match the algorithm in recorder.ts and replayer.ts exactly. */
function djb2(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Build a minimal empty-event trace with a pre-computed outputHash. */
function traceWithOutputHash<T>(finalOutput: T): ExecutionTrace<T> {
  const outputStr =
    typeof finalOutput === "string"
      ? finalOutput
      : JSON.stringify(finalOutput);
  return {
    id: "trace_integrity_test",
    version: TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 100,
    endTime: Date.now(),
    events: [],
    checkpoints: [],
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: 0,
      durationMs: 100,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: 0,
      outputHash: djb2(outputStr),
    },
    finalOutput,
  };
}

/** Build a minimal trace WITHOUT outputHash (simulates older traces). */
function traceWithoutOutputHash<T>(finalOutput: T): ExecutionTrace<T> {
  return {
    id: "trace_no_hash",
    version: TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 100,
    endTime: Date.now(),
    events: [],
    checkpoints: [],
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: 0,
      durationMs: 100,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: 0,
    },
    finalOutput,
  };
}

function createMockRecorder() {
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  return {
    events,
    appendEvent: vi.fn(
      (event: { type: string; agentId: string; payload: unknown }) => {
        events.push({
          type: event.type,
          payload: event.payload as Record<string, unknown>,
        });
      },
    ),
    getAgentId: vi.fn().mockReturnValue("test-agent"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 1 — outputHash was computed then discarded
// ─────────────────────────────────────────────────────────────────────────────

describe("B10 Defect 1 — verifyFinalOutputIntegrity must compare the stored hash", () => {
  it("detects a tampered finalOutput via outputHash mismatch", async () => {
    // Trace whose metadata.outputHash belongs to "real-output"
    // but whose finalOutput has been changed to "tampered-output".
    const goodTrace = traceWithOutputHash("real-output");
    const tamperedTrace: ExecutionTrace<string> = {
      ...goodTrace,
      finalOutput: "tampered-output", // hash mismatch
    };

    const replayer = new TraceReplayer(tamperedTrace);
    const result = await replayer.replay();

    // PRE-FIX: hash computed → discarded → result.matched = true, 0 divergences
    // POST-FIX: mismatch detected → matched = false, ≥1 critical divergence
    expect(result.matched).toBe(false);
    const criticals = result.divergences.filter(
      (d) => d.severity === "critical",
    );
    expect(criticals.length).toBeGreaterThan(0);
  });

  it("is backward-compatible: skips check when outputHash is absent", async () => {
    // Old trace format without outputHash — must not emit spurious divergences.
    const trace = traceWithoutOutputHash("any-output");
    const replayer = new TraceReplayer(trace);
    const result = await replayer.replay();

    expect(result.matched).toBe(true);
    expect(result.divergences).toHaveLength(0);
  });

  it("passes cleanly when finalOutput matches the stored outputHash", async () => {
    const trace = traceWithOutputHash("the-real-output");
    const replayer = new TraceReplayer(trace);
    const result = await replayer.replay();

    expect(result.matched).toBe(true);
    expect(
      result.divergences.filter((d) => d.severity === "critical"),
    ).toHaveLength(0);
  });

  it("TraceRecorder.finalize() stores outputHash in metadata", () => {
    const recorder = new TraceRecorder();
    recorder.setAgentId("agent-1");
    const trace = recorder.finalize("my-output");

    expect(trace.metadata.outputHash).toBeDefined();
    expect(trace.metadata.outputHash).toBe(djb2("my-output"));
  });

  it("TraceRecorder stores correct outputHash for object finalOutput", () => {
    const recorder = new TraceRecorder();
    recorder.setAgentId("agent-1");
    const output = { answer: 42, items: ["a", "b"] };
    const trace = recorder.finalize(output);

    expect(trace.metadata.outputHash).toBe(djb2(JSON.stringify(output)));
  });

  it("a round-trip record→replay with matching content produces no critical divergences", async () => {
    const recorder = new TraceRecorder();
    recorder.setAgentId("agent-1");
    const trace = recorder.finalize({ score: 99 });

    const replayer = new TraceReplayer(trace);
    const result = await replayer.replay();

    expect(
      result.divergences.filter((d) => d.severity === "critical"),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 2 — verify() ran agent once (vacuous determinism check)
// ─────────────────────────────────────────────────────────────────────────────

describe("B10 Defect 2 — TestHarness.verify() must call execute() twice", () => {
  it("throws DeterminismError when execute() returns different values per call", async () => {
    const harness = createTestHarness();
    let callCount = 0;

    const execute = async (): Promise<RehearsalResult<string>> => {
      callCount++;
      return {
        value: `result-${callCount}`, // Different on every invocation
        trace: traceWithOutputHash(`result-${callCount}`),
      };
    };

    // PRE-FIX: execute() called once, replay returns trace.finalOutput (="result-1")
    //          → "result-1" === "result-1" → no throw
    // POST-FIX: execute() called twice → "result-1" ≠ "result-2" → DeterminismError
    await expect(harness.verify(execute)).rejects.toThrow(DeterminismError);
    expect(callCount).toBe(2); // must have been invoked twice
  });

  it("does NOT throw for a deterministic agent (same value on every call)", async () => {
    const harness = createTestHarness();

    const execute = async (): Promise<RehearsalResult<string>> => ({
      value: "stable-result",
      trace: traceWithOutputHash("stable-result"),
    });

    await expect(harness.verify(execute)).resolves.not.toThrow();
  });

  it("DeterminismError contains a non-empty diff", async () => {
    const harness = createTestHarness();
    let n = 0;

    const execute = async (): Promise<RehearsalResult<Record<string, number>>> => {
      n++;
      return {
        value: { score: n * 10 },
        trace: traceWithOutputHash({ score: n * 10 }),
      };
    };

    const err = await harness.verify(execute).catch((e) => e);
    expect(err).toBeInstanceOf(DeterminismError);
    expect((err as DeterminismError).differences.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFECT 3 — default recording omitted response text; replay substituted ""
// ─────────────────────────────────────────────────────────────────────────────

describe("B10 Defect 3 — response text must be recorded regardless of includePrompts", () => {
  it("includes response text in llm_response event payload when includePrompts=false (default)", async () => {
    const interceptor = new RecordingLLMInterceptor(); // default includePrompts=false
    const recorder = createMockRecorder();
    interceptor.install(recorder);

    await interceptor.recordCall(
      { model: "gpt-4", prompt: "Hello" },
      async () => ({ response: "actual-response-text", latencyMs: 100 }),
    );

    const responseEvent = recorder.events.find(
      (e) => e.type === "llm_response",
    );
    expect(responseEvent).toBeDefined();

    // PRE-FIX: responseEvent.payload.response === undefined
    // POST-FIX: responseEvent.payload.response === "actual-response-text"
    expect(responseEvent!.payload["response"]).toBe("actual-response-text");
  });

  it("still excludes PROMPT text when includePrompts=false", async () => {
    const interceptor = new RecordingLLMInterceptor(); // includePrompts=false
    const recorder = createMockRecorder();
    interceptor.install(recorder);

    await interceptor.recordCall(
      { model: "gpt-4", prompt: "secret-prompt" },
      async () => ({ response: "some-response", latencyMs: 50 }),
    );

    const callEvent = recorder.events.find((e) => e.type === "llm_call");
    expect(callEvent).toBeDefined();
    expect(callEvent!.payload["prompt"]).toBeUndefined(); // prompt excluded (privacy)
    expect(callEvent!.payload["promptHash"]).toBeDefined(); // hash retained

    const responseEvent = recorder.events.find((e) => e.type === "llm_response");
    expect(responseEvent!.payload["response"]).toBe("some-response"); // always included
  });

  it("applies redactPatterns to response text even though it is always recorded", async () => {
    const interceptor = new RecordingLLMInterceptor({
      redactPatterns: [/secret-\d+/g],
    });
    const recorder = createMockRecorder();
    interceptor.install(recorder);

    await interceptor.recordCall(
      { model: "gpt-4", prompt: "test" },
      async () => ({ response: "Response with secret-99999", latencyMs: 50 }),
    );

    const responseEvent = recorder.events.find((e) => e.type === "llm_response");
    expect(responseEvent!.payload["response"]).toBe("Response with [REDACTED]");
  });

  it("extractLLMCalls returns real response text (not empty string) for replay", async () => {
    // Full end-to-end: record without includePrompts, build a trace, replay it.
    // The replay interceptor must return the real text, not "".
    const recorder = new TraceRecorder();
    recorder.setAgentId("test-agent");

    const llmInterceptor = new RecordingLLMInterceptor(); // default: includePrompts=false
    llmInterceptor.install(recorder);

    await llmInterceptor.recordCall(
      { model: "gpt-4", prompt: "hi" },
      async () => ({ response: "the-real-response", latencyMs: 10 }),
    );

    const trace = recorder.finalize(null);

    const replayer = new TraceReplayer(trace);
    const replayInterceptor = replayer.getLLMInterceptor();
    expect(replayInterceptor).not.toBeNull();

    const replayResponse = await replayInterceptor!.replayCall({
      model: "gpt-4",
      prompt: "hi",
    });

    // PRE-FIX: replayResponse.response = "" (undefined payload → "" fallback in extractLLMCalls)
    // POST-FIX: replayResponse.response = "the-real-response"
    expect(replayResponse.response).toBe("the-real-response");
  });
});
