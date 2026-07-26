/**
 * @fileoverview Tests for golden trace format (CR-501)
 * @module weft-core/rehearsal/__tests__/golden
 * @description Covers: toGoldenTrace contract, redaction scope (all sensitive
 *   event fields + finalOutput), replayAgentWithTrace with genuine factory
 *   execution, divergence detection, no-live-call guarantee via injected
 *   interceptor, schema migration, and TraceVersionError.
 *
 * Rule 015: every assertion must fail if the capability is broken.
 *   Tests that previously passed vacuously (factory never called) have been
 *   replaced with assertions that require genuine factory execution.
 */

import { createHash } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
// Must import from the package barrel so all operators are prototype-augmented.
// Importing from AgentUnit/AgentUnit directly leaves .retry undefined and causes
// SETUP_ERROR when unit.run() is called by replayAgentWithTrace.
import { AgentUnit } from "../../index";
import {
  _clearMigrationsForTest,
  extractLLMCallsFromTrace,
  type GoldenTrace,
  registerTraceMigration,
  replayAgentWithTrace,
  toGoldenTrace,
  WEFT_REPLAY_INTERCEPTOR_KEY,
} from "../golden";
import { ReplayLLMInterceptor } from "../interceptor";
import type { ExecutionTrace, TraceEvent } from "../types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "../types";

// ─── Additional test helpers ──────────────────────────────────────────────────

/**
 * Like makeEvent but with an explicit agentId — required for concurrent-pairing
 * tests where events from two different agents must be distinguishable.
 */
function makeAgentEvent(
  id: string,
  agentId: string,
  type: TraceEvent["type"],
  payload: Record<string, unknown>,
): TraceEvent {
  const base: Omit<TraceEvent, "hash"> = {
    id,
    type,
    agentId,
    timestamp: 1000,
    vectorClock: { [agentId]: 1 },
    payload: payload as TraceEvent["payload"],
  };
  return { ...base, hash: computeEventHash(base) };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** DJB2 hash — mirrors recorder.ts (must match for event integrity checks). */
function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function computeEventHash(event: Omit<TraceEvent, "hash">): string {
  return djb2Hash(
    JSON.stringify({
      id: event.id,
      type: event.type,
      agentId: event.agentId,
      timestamp: event.timestamp,
      vectorClock: event.vectorClock,
      payload: event.payload,
    }),
  );
}

function makeEvent(
  id: string,
  type: TraceEvent["type"] = "operator",
  payload: Record<string, unknown> = { operator: "test", durationMs: 0 },
): TraceEvent {
  const base: Omit<TraceEvent, "hash"> = {
    id,
    type,
    agentId: "agent-test",
    timestamp: 1000,
    vectorClock: { "agent-test": 1 },
    payload: payload as TraceEvent["payload"],
  };
  return { ...base, hash: computeEventHash(base) };
}

function makeTrace<T>(
  finalOutput: T,
  events: TraceEvent[] = [],
): ExecutionTrace<T> {
  return {
    id: "trace-test-001",
    version: TRACE_SCHEMA_VERSION,
    startTime: 1000,
    endTime: 2000,
    events,
    checkpoints: [],
    finalOutput,
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: events.length,
      durationMs: 1000,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: 0,
    },
  };
}

// ─── toGoldenTrace ────────────────────────────────────────────────────────────

describe("toGoldenTrace", () => {
  it("sets golden: true and adds contract", () => {
    const trace = makeTrace("result-a");
    const golden = toGoldenTrace(trace);

    expect(golden.golden).toBe(true);
    expect(golden.contract).toBeDefined();
  });

  it("contract.finalOutputHash is SHA-256 of JSON.stringify(finalOutput)", () => {
    const trace = makeTrace({ value: "hello", count: 3 });
    const golden = toGoldenTrace(trace);
    const expected = sha256hex(JSON.stringify({ value: "hello", count: 3 }));

    expect(golden.contract.finalOutputHash).toBe(expected);
  });

  it("contract.schemaVersion matches the trace version", () => {
    const trace = makeTrace("x");
    const golden = toGoldenTrace(trace);
    expect(golden.contract.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
  });

  it("contract.expectedLlmCallCount counts only llm_call events", () => {
    const events = [
      makeEvent("e1", "llm_call", { model: "claude-3", promptHash: "abc", prompt: undefined }),
      makeEvent("e2", "operator", { operator: "map", durationMs: 0 }),
      makeEvent("e3", "llm_call", { model: "claude-3", promptHash: "def", prompt: undefined }),
    ];
    const trace = makeTrace("out", events);
    const golden = toGoldenTrace(trace);
    expect(golden.contract.expectedLlmCallCount).toBe(2);
  });

  it("preserves finalOutput and all trace fields", () => {
    const trace = makeTrace({ answer: 42 });
    const golden = toGoldenTrace(trace);
    expect(golden.finalOutput).toEqual({ answer: 42 });
    expect(golden.id).toBe(trace.id);
  });

  it("does not mutate the original trace", () => {
    const trace = makeTrace("sk-original");
    toGoldenTrace(trace, { redactPatterns: [/sk-[a-z0-9]+/gi] });
    expect(trace.finalOutput).toBe("sk-original");
  });

  describe("secret redaction — full scope", () => {
    it("redacts secrets from finalOutput and recomputes hash from redacted value", () => {
      const trace = makeTrace("api-key=sk-secret123 result");
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z0-9]+/gi],
      });

      expect(String(golden.finalOutput)).toContain("[REDACTED]");
      expect(String(golden.finalOutput)).not.toContain("sk-secret123");

      const expectedHash = sha256hex(JSON.stringify(golden.finalOutput));
      expect(golden.contract.finalOutputHash).toBe(expectedHash);
    });

    it("redacts secret from llm_call event prompt field", () => {
      const callEvent = makeEvent("e1", "llm_call", {
        model: "claude-3",
        promptHash: "abc",
        prompt: "Your API key is sk-secret99",
        systemPrompt: undefined,
      });
      const responseEvent = makeEvent("e2", "llm_response", {
        model: "claude-3",
        response: "ok",
        responseHash: "rh1",
        latencyMs: 10,
      });
      const trace = makeTrace("out", [callEvent, responseEvent]);
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z0-90-9]+/gi],
      });

      const callPayload = golden.events[0].payload as Record<string, unknown>;
      expect(callPayload.prompt).toContain("[REDACTED]");
      expect(String(callPayload.prompt)).not.toContain("sk-secret99");
    });

    it("redacts secret from llm_call event systemPrompt field", () => {
      const callEvent = makeEvent("e1", "llm_call", {
        model: "claude-3",
        promptHash: "abc",
        prompt: "hello",
        systemPrompt: "Use token sk-adminkey to authenticate",
      });
      const responseEvent = makeEvent("e2", "llm_response", {
        model: "claude-3",
        response: "ok",
        responseHash: "rh1",
        latencyMs: 10,
      });
      const trace = makeTrace("out", [callEvent, responseEvent]);
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z]+/gi],
      });

      const callPayload = golden.events[0].payload as Record<string, unknown>;
      expect(callPayload.systemPrompt).toContain("[REDACTED]");
      expect(String(callPayload.systemPrompt)).not.toContain("sk-adminkey");
    });

    it("redacts secret from llm_response event response field", () => {
      const callEvent = makeEvent("e1", "llm_call", {
        model: "claude-3",
        promptHash: "abc",
        prompt: "hello",
      });
      const responseEvent = makeEvent("e2", "llm_response", {
        model: "claude-3",
        response: "Here is the secret: sk-resp123",
        responseHash: "rh1",
        latencyMs: 10,
      });
      const trace = makeTrace("out", [callEvent, responseEvent]);
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z0-9]+/gi],
      });

      const responsePayload = golden.events[1].payload as Record<string, unknown>;
      expect(responsePayload.response).toContain("[REDACTED]");
      expect(String(responsePayload.response)).not.toContain("sk-resp123");
    });

    it("event hashes are recomputed after redaction so integrity checks pass", () => {
      const callEvent = makeEvent("e1", "llm_call", {
        model: "claude-3",
        promptHash: "abc",
        prompt: "Use token sk-secret to authenticate",
      });
      const trace = makeTrace("out", [callEvent]);
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z]+/gi],
      });

      // The stored hash must match the hash of the redacted payload
      const redactedEvent = golden.events[0];
      const expectedHash = computeEventHash({
        id: redactedEvent.id,
        type: redactedEvent.type,
        agentId: redactedEvent.agentId,
        timestamp: redactedEvent.timestamp,
        vectorClock: redactedEvent.vectorClock,
        payload: redactedEvent.payload,
      });
      expect(redactedEvent.hash).toBe(expectedHash);
    });

    it("handles non-string finalOutput with object redaction", () => {
      const trace = makeTrace({ token: "Bearer sk-secret", user: "alice" });
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z]+/gi],
      });
      const out = golden.finalOutput as { token: string; user: string };
      expect(out.token).toContain("[REDACTED]");
      expect(out.user).toBe("alice");
    });

    it("leaves events unchanged when no redactPatterns provided", () => {
      const callEvent = makeEvent("e1", "llm_call", {
        model: "m",
        promptHash: "h",
        prompt: "hello",
      });
      const trace = makeTrace("out", [callEvent]);
      const golden = toGoldenTrace(trace); // no patterns

      const callPayload = golden.events[0].payload as Record<string, unknown>;
      expect(callPayload.prompt).toBe("hello");
      expect(golden.events[0].hash).toBe(callEvent.hash); // hash unchanged
    });
  });
});

// ─── replayAgentWithTrace ─────────────────────────────────────────────────────

describe("replayAgentWithTrace", () => {
  it("returns matched: true when factory produces same output as golden", async () => {
    const trace = makeTrace("response-a", [makeEvent("e1")]);
    const golden = toGoldenTrace(trace);

    // Factory must produce the same output that was recorded.
    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("response-a"),
    });

    expect(matched).toBe(true);
    expect(divergences).toHaveLength(0);
  });

  it("returns matched: false when factory produces different output (agent changed)", async () => {
    const trace = makeTrace("approved", [makeEvent("e1")]);
    const golden = toGoldenTrace(trace);

    // Factory now returns "denied" — agent changed since the trace was recorded.
    // Pre-fix: this test FAILED (matched was true because factory was never called).
    // Post-fix: factory runs → hash("denied") ≠ hash("approved") → matched: false.
    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("denied"),
    });

    expect(matched).toBe(false);
    const hashDiv = divergences.find((d) => d.eventId === "golden:finalOutputHash");
    expect(hashDiv).toBeDefined();
    expect(hashDiv?.severity).toBe("critical");
    expect(hashDiv?.description).toContain("Final output hash mismatch");
  });

  it("divergence description names expected and actual hash prefixes", async () => {
    const trace = makeTrace("original");
    const golden = toGoldenTrace(trace);

    // Factory now produces "changed" instead of "original"
    const { divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("changed"),
    });

    const div = divergences.find((d) => d.eventId === "golden:finalOutputHash");
    expect(div?.description).toMatch(/\w{16}…/); // SHA-256 prefix present in description
  });

  it("detects LLM call count mismatch: factory makes fewer calls than recorded", async () => {
    // Golden records an agent that made one LLM call
    const callEvent = makeEvent("e1", "llm_call", { model: "m", promptHash: "h" });
    const responseEvent = makeEvent("e2", "llm_response", {
      model: "m",
      response: "r1",
      responseHash: "rh1",
      latencyMs: 10,
    });
    const trace = makeTrace("out", [callEvent, responseEvent]);
    const golden = toGoldenTrace(trace);

    // Factory produces the correct output but makes 0 interceptor calls.
    // callsConsumed(0) ≠ expectedLlmCallCount(1) → count divergence.
    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("out"),
    });

    expect(matched).toBe(false);
    const countDiv = divergences.find((d) => d.eventId === "golden:llmCallCount");
    expect(countDiv).toBeDefined();
    expect(countDiv?.description).toContain("LLM call count mismatch");
    expect(countDiv?.expected).toBe(1);
    expect(countDiv?.actual).toBe(0);
  });

  it("result carries the factory output when matched", async () => {
    const trace = makeTrace("ok");
    const golden = toGoldenTrace(trace);

    const { result } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("ok"),
    });

    expect(result).toBeDefined();
    expect(result.value).toBe("ok");
    expect(result.source).toBe("agent");
    expect(result.confidence).toBe(1);
  });

  it("result.confidence is 0 when matched is false", async () => {
    const trace = makeTrace("a");
    const golden = toGoldenTrace(trace);

    // Factory now produces "b" instead of "a" — changed agent
    const { result, matched } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("b"),
    });

    expect(matched).toBe(false);
    expect(result.confidence).toBe(0);
  });

  describe("no live provider call during replay", () => {
    it("serves recorded responses via injected interceptor, making no live call", async () => {
      // Golden records one LLM call with response "recorded-answer".
      // promptHash must be DJB2(prompt) — the sequence hash check compares the
      // actual prompt hash the factory sends against what was recorded.
      const prompt = "hello";
      const callEvent = makeEvent("e1", "llm_call", {
        model: "test-model",
        promptHash: djb2Hash(prompt), // correct: DJB2 of the actual prompt
        prompt,
      });
      const responseEvent = makeEvent("e2", "llm_response", {
        model: "test-model",
        response: "recorded-answer",
        responseHash: djb2Hash("recorded-answer"), // correct: DJB2 of the response
        latencyMs: 10,
      });
      const trace = makeTrace("recorded-answer", [callEvent, responseEvent]);
      const golden = toGoldenTrace(trace);

      let liveCallMade = false;

      // Factory that uses the injected replay interceptor.
      // When the interceptor is present, it returns the recorded response.
      // When absent, it would fall through to a live call — which must not happen.
      const interceptingFactory = () =>
        AgentUnit.from(async (ctx) => {
          const interceptor = ctx.extensions?.[WEFT_REPLAY_INTERCEPTOR_KEY] as
            | ReplayLLMInterceptor
            | undefined;
          if (interceptor) {
            const response = await interceptor.replayCall({
              model: "test-model",
              prompt: "hello",
            });
            return response.response;
          }
          liveCallMade = true;
          return "live-answer";
        });

      const { matched } = await replayAgentWithTrace({
        trace: golden,
        factory: interceptingFactory,
      });

      // Interceptor was used — no live call
      expect(liveCallMade).toBe(false);
      // Factory output "recorded-answer" matches golden contract — all calls consumed
      expect(matched).toBe(true);
    });

    it("old vacuous test replaced: factory IS called during replay", async () => {
      // This documents the before/after behavior change.
      // Before fix: factory was NEVER called → computationCalled always false (vacuous).
      // After fix: factory IS called; computationCalled reflects actual execution.
      let computationCalled = false;

      const trace = makeTrace("value");
      const golden = toGoldenTrace(trace);

      await replayAgentWithTrace({
        trace: golden,
        factory: () =>
          AgentUnit.from(async () => {
            computationCalled = true;
            return "value";
          }),
      });

      // The computation was executed — this is the corrected guarantee
      expect(computationCalled).toBe(true);
    });
  });

  describe("schema version migration", () => {
    afterEach(() => {
      _clearMigrationsForTest();
    });

    it("throws TraceVersionError when version mismatches and no migration registered", async () => {
      const trace = makeTrace("x");
      const golden = toGoldenTrace(trace);
      const staleGolden = {
        ...golden,
        version: "0.9.0" as typeof TRACE_SCHEMA_VERSION,
      };

      await expect(
        replayAgentWithTrace({
          trace: staleGolden as GoldenTrace<string>,
          factory: () => AgentUnit.of("x"),
        }),
      ).rejects.toThrow(TraceVersionError);
    });

    it("TraceVersionError message includes migration guidance", async () => {
      const trace = makeTrace("x");
      const golden = toGoldenTrace(trace);
      const staleGolden = {
        ...golden,
        version: "0.9.0" as typeof TRACE_SCHEMA_VERSION,
      };

      let thrown: Error | null = null;
      try {
        await replayAgentWithTrace({
          trace: staleGolden as GoldenTrace<string>,
          factory: () => AgentUnit.of("x"),
        });
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown).toBeInstanceOf(TraceVersionError);
      expect(thrown?.message).toMatch(/registerTraceMigration/);
    });

    it("silently upgrades when a migration is registered for the version delta", async () => {
      const trace = makeTrace("migrated-output");
      const golden = toGoldenTrace(trace);
      const oldVersion = "0.9.0" as typeof TRACE_SCHEMA_VERSION;

      registerTraceMigration("0.9.0", TRACE_SCHEMA_VERSION, (t) => ({
        ...t,
        version: TRACE_SCHEMA_VERSION,
      }));

      const staleGolden: GoldenTrace<string> = {
        ...golden,
        version: oldVersion,
        contract: {
          ...golden.contract,
          schemaVersion: "0.9.0",
        },
      };

      // Should NOT throw — migration upgrades it
      const { matched } = await replayAgentWithTrace({
        trace: staleGolden,
        factory: () => AgentUnit.of("migrated-output"),
      });
      // Factory produces "migrated-output" which matches the contract → true
      expect(matched).toBe(true);
    });
  });
});

// ─── extractLLMCallsFromTrace ─────────────────────────────────────────────────

describe("extractLLMCallsFromTrace", () => {
  it("returns empty array when trace has no LLM events", () => {
    const trace = makeTrace("out");
    expect(extractLLMCallsFromTrace(trace)).toHaveLength(0);
  });

  it("extracts matched llm_call + llm_response pairs", () => {
    const callEvent = makeEvent("e1", "llm_call", {
      model: "claude-3",
      promptHash: "abc123",
      prompt: undefined,
    });
    const responseEvent = makeEvent("e2", "llm_response", {
      model: "claude-3",
      response: "The answer is 42",
      responseHash: "def456",
      latencyMs: 50,
    });
    const trace = makeTrace("out", [callEvent, responseEvent]);
    const calls = extractLLMCallsFromTrace(trace);

    expect(calls).toHaveLength(1);
    expect(calls[0].config.model).toBe("claude-3");
    expect(calls[0].response.response).toBe("The answer is 42");
    expect(calls[0].responseHash).toBe("def456");
  });

  it("handles multiple llm_call/llm_response pairs", () => {
    const events = [
      makeEvent("e1", "llm_call", { model: "m", promptHash: "h1" }),
      makeEvent("e2", "llm_response", { model: "m", response: "r1", responseHash: "rh1", latencyMs: 10 }),
      makeEvent("e3", "llm_call", { model: "m", promptHash: "h2" }),
      makeEvent("e4", "llm_response", { model: "m", response: "r2", responseHash: "rh2", latencyMs: 10 }),
    ];
    const calls = extractLLMCallsFromTrace(makeTrace("out", events));
    expect(calls).toHaveLength(2);
    expect(calls[0].response.response).toBe("r1");
    expect(calls[1].response.response).toBe("r2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safe-by-omission redaction.
//
// A golden trace is committed to the caller's repository. The original
// implementation redacted only when the caller remembered to pass
// redactPatterns, so the happy path — toGoldenTrace(trace) — wrote raw prompts
// and responses into a file destined for git. These pin the default.
// ─────────────────────────────────────────────────────────────────────────────

describe("toGoldenTrace — default redaction (safe by omission)", () => {
  const OPENAI_KEY = `sk-${"a1b2c3d4e5f6g7h8".repeat(2)}`;
  const ANTHROPIC_KEY = `sk-ant-${"x9y8z7w6v5u4t3s2".repeat(2)}`;

  it("strips credentials from prompts with NO options supplied at all", () => {
    const trace = makeTrace("done", [
      makeEvent("e-1", "llm_call", {
        prompt: `Use ${OPENAI_KEY} to call the API`,
        systemPrompt: `Auth: Bearer ${"t".repeat(32)}`,
        model: "gpt-4o",
      }),
      makeEvent("e-2", "llm_response", {
        response: `Your key ${ANTHROPIC_KEY} worked`,
        model: "gpt-4o",
      }),
    ]);

    const golden = toGoldenTrace(trace);
    const serialized = JSON.stringify(golden);

    expect(serialized).not.toContain(OPENAI_KEY);
    expect(serialized).not.toContain(ANTHROPIC_KEY);
    expect(serialized).not.toMatch(/Bearer\s+t{32}/);
    expect(serialized).toContain("[REDACTED]");
  });

  it("strips credentials from finalOutput with no options supplied", () => {
    const golden = toGoldenTrace(makeTrace(`token=${OPENAI_KEY}`));
    expect(JSON.stringify(golden.finalOutput)).not.toContain(OPENAI_KEY);
  });

  it("caller patterns extend the defaults rather than replacing them", () => {
    const trace = makeTrace("ok", [
      makeEvent("e-1", "llm_call", {
        prompt: `${OPENAI_KEY} and INTERNAL-7788`,
        model: "gpt-4o",
      }),
    ]);

    const serialized = JSON.stringify(
      toGoldenTrace(trace, { redactPatterns: [/INTERNAL-\d+/g] }),
    );

    // Custom pattern applied...
    expect(serialized).not.toContain("INTERNAL-7788");
    // ...and the built-in floor still held.
    expect(serialized).not.toContain(OPENAI_KEY);
  });

  it("useDefaultRedactions:false opts out for a trace known to be clean", () => {
    const trace = makeTrace("ok", [
      makeEvent("e-1", "llm_call", { prompt: OPENAI_KEY, model: "gpt-4o" }),
    ]);

    const serialized = JSON.stringify(
      toGoldenTrace(trace, { useDefaultRedactions: false }),
    );

    expect(serialized).toContain(OPENAI_KEY);
  });

  it("leaves ordinary prose untouched", () => {
    const prose = "The task is to summarise the quarterly report for review.";
    const golden = toGoldenTrace(makeTrace(prose));
    expect(golden.finalOutput).toBe(prose);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic redaction: ALL event payload string fields, not just llm_call/response
//
// Pre-fix: redactEventPayload type-switched on event.type and returned every
// non-LLM event unchanged, so a secret in an operator, error, checkpoint, or
// consensus-vote payload survived into the committed trace file.
//
// Post-fix: a generic string-deep-walk redacts all string fields across every
// event type, making the safety floor event-type-agnostic.
//
// Rule 015: each test asserts a property that the pre-fix code violates, so
// each test FAILS before the fix and PASSES after.
// ─────────────────────────────────────────────────────────────────────────────

describe("toGoldenTrace — generic redaction covers all event types (finding 1)", () => {
  it("redacts a secret planted in an operator event payload — pre-fix FAILS", () => {
    const trace = makeTrace("ok", [
      // operator event is not llm_call or llm_response — pre-fix leaves it unchanged
      makeEvent("e1", "operator", {
        operator: "tool-fetch",
        durationMs: 0,
        inputHash: "TOPSECRET-operatorpayload",
      }),
    ]);
    const golden = toGoldenTrace(trace, { redactPatterns: [/TOPSECRET-\w+/g] });
    const serialized = JSON.stringify(golden);
    expect(serialized).not.toContain("TOPSECRET-operatorpayload");
    expect(serialized).toContain("[REDACTED]");
  });

  it("redacts a secret planted in an error event message — pre-fix FAILS", () => {
    const trace = makeTrace("ok", [
      makeEvent("e1", "error", {
        code: "E001",
        message: "Auth failed with key TOPSECRET-errorfield",
      }),
    ]);
    const golden = toGoldenTrace(trace, { redactPatterns: [/TOPSECRET-\w+/g] });
    const serialized = JSON.stringify(golden);
    expect(serialized).not.toContain("TOPSECRET-errorfield");
    expect(serialized).toContain("[REDACTED]");
  });

  it("secret is absent and event hash matches the redacted payload — pre-fix FAILS", () => {
    // Pre-fix: operator event returned unchanged → secret survives AND hash is
    // computed from the un-redacted payload → first assertion fails.
    // Post-fix: secret is stripped, hash recomputed from redacted payload → both pass.
    const operatorEvent = makeEvent("e1", "operator", {
      operator: "tool-fetch",
      durationMs: 0,
      inputHash: "TOPSECRET-hashtest",
    });
    const trace = makeTrace("ok", [operatorEvent]);
    const golden = toGoldenTrace(trace, { redactPatterns: [/TOPSECRET-\w+/g] });

    const redactedEvent = golden.events[0];
    // Secret must be gone (fails pre-fix — event returned unchanged)
    expect(JSON.stringify(redactedEvent.payload)).not.toContain("TOPSECRET-hashtest");
    // Hash must match the final (redacted) payload
    const expectedHash = computeEventHash({
      id: redactedEvent.id,
      type: redactedEvent.type,
      agentId: redactedEvent.agentId,
      timestamp: redactedEvent.timestamp,
      vectorClock: redactedEvent.vectorClock,
      payload: redactedEvent.payload,
    });
    expect(redactedEvent.hash).toBe(expectedHash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero-token guarantee (finding 2) — decision: narrow the claim
//
// The provider layer (ProviderRegistry) is a thin Map with no middleware hook.
// Adding interception there is invasive machinery; this campaign has twice shown
// that defensive machinery for hard cases makes them worse (verdict wording).
//
// Decision: narrow the claim. The zero-token guarantee applies ONLY to agents
// that check WEFT_REPLAY_INTERCEPTOR_KEY. Agents that skip the check may make
// live provider calls. replayAgentWithTrace cannot prevent this without
// provider-level interception. What it CAN do — and does — is emit a CRITICAL
// `golden:llmCallCount` divergence when the call count does not match, making
// the violation loud rather than silent.
//
// The module doc and JSDoc for replayAgentWithTrace are updated to state this
// precisely. The test below pins the observable behavior a caller experiences
// when a factory ignores the interceptor.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Finding 1 — applyRedact global flag
//
// Pre-fix: `applyRedact` called `String.replace(p, "[REDACTED]")`. When the
// caller omits the `g` flag, `String.replace` replaces only the FIRST occurrence.
// A string with the secret appearing twice would have the first redacted and
// the second written verbatim into the committed trace.
//
// Post-fix: `applyRedact` forces global replacement by creating a new RegExp
// with the `g` flag when the supplied pattern lacks it.
//
// Rule 015: the test FAILS pre-fix (second occurrence survives) and PASSES post-fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("applyRedact — global flag enforcement (finding 1)", () => {
  it("redacts ALL occurrences when the caller omits the g flag — pre-fix replaces only first", () => {
    // Pattern WITHOUT the g flag — pre-fix: String.replace replaces the first only.
    const noGFlag = /private-token/; // deliberate: no 'g'
    const trace = makeTrace("private-token and also private-token");
    const golden = toGoldenTrace(trace, {
      redactPatterns: [noGFlag],
      useDefaultRedactions: false,
    });

    // Both occurrences must be gone. Pre-fix: second survives → this assertion FAILS.
    expect(String(golden.finalOutput)).not.toContain("private-token");
  });

  it("handles a secret appearing three times in an event payload — all must be redacted", () => {
    const noGFlag = /TOKEN/; // no 'g'
    const callEvent = makeEvent("e1", "llm_call", {
      model: "m",
      promptHash: "h",
      prompt: "TOKEN TOKEN TOKEN",
    });
    const trace = makeTrace("ok", [callEvent]);
    const golden = toGoldenTrace(trace, {
      redactPatterns: [noGFlag],
      useDefaultRedactions: false,
    });
    const callPayload = golden.events[0].payload as Record<string, unknown>;
    expect(String(callPayload.prompt)).not.toContain("TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 2 — unified interceptor key
//
// Pre-fix: golden.ts exported `WEFT_REPLAY_INTERCEPTOR_KEY = "_weftReplayInterceptor"`
// but did NOT export it from the rehearsal barrel. The harness (weft-harness) exports
// `INTERCEPTOR_EXTENSION_KEY = "__weft_interceptor"`. An agent instrumented using the
// harness key would check a different extensions slot than what `replayAgentWithTrace`
// injects, silently falling through to a live provider during what is advertised as
// a free CI assertion.
//
// Post-fix: the key is changed to `"__weft_interceptor"` and exported from the barrel.
// `replayAgentWithTrace` injects under the same key the harness uses.
//
// Rule 015: the string-value test FAILS pre-fix ("_weftReplayInterceptor" ≠ "__weft_interceptor")
// and PASSES post-fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("WEFT_REPLAY_INTERCEPTOR_KEY — unified key (finding 2)", () => {
  it("WEFT_REPLAY_INTERCEPTOR_KEY is '__weft_interceptor' — the same key AgentUnitHarness uses (pre-fix FAILS)", () => {
    // Pre-fix value: "_weftReplayInterceptor" → assertion fails.
    // Post-fix value: "__weft_interceptor" → assertion passes.
    expect(WEFT_REPLAY_INTERCEPTOR_KEY).toBe("__weft_interceptor");
  });

  it("replayAgentWithTrace injects under WEFT_REPLAY_INTERCEPTOR_KEY and the factory receives it", async () => {
    // This confirms the injected key matches what the factory checks.
    const trace = makeTrace("value");
    const golden = toGoldenTrace(trace);

    let receivedKey: string | undefined;
    await replayAgentWithTrace({
      trace: golden,
      factory: () =>
        AgentUnit.from(async (ctx) => {
          // Enumerate keys to find which one has a non-undefined interceptor value
          for (const [k, v] of Object.entries(ctx.extensions ?? {})) {
            if (v !== undefined) receivedKey = k;
          }
          return "value";
        }),
    });

    expect(receivedKey).toBe("__weft_interceptor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 3 — replay correctness (LLM event sequence hash)
//
// Pre-fix: the contract only checked finalOutputHash and expectedLlmCallCount.
// A factory change that altered LLM prompt content (e.g. "debit $10" → "debit $1000")
// while keeping the same output and call count returned `matched: true` — the
// behavioral change was invisible to replay.
//
// Post-fix: `GoldenTraceContract` gains `llmEventSequenceHash` — SHA-256 of
// [{promptHash, responseHash}, ...] for all LLM calls in order. A changed prompt
// in any position diverges the sequence hash and produces a CRITICAL divergence.
//
// Rule 015: the sequence-hash divergence test FAILS pre-fix (no sequence check,
// matched=true) and PASSES post-fix (matched=false, critical divergence present).
//
// Documented limitation: side effects that never appear in any LLM prompt or
// response (fully hardcoded, no LLM involvement) remain outside the trace and
// are not detectable by replay regardless of this fix.
// ─────────────────────────────────────────────────────────────────────────────

describe("replayAgentWithTrace — LLM event sequence hash (finding 3)", () => {
  it("toGoldenTrace includes llmEventSequenceHash in the contract", () => {
    const callEvent = makeEvent("e1", "llm_call", {
      model: "m",
      promptHash: djb2Hash("hello"),
      prompt: "hello",
    });
    const responseEvent = makeEvent("e2", "llm_response", {
      model: "m",
      response: "world",
      responseHash: djb2Hash("world"),
      latencyMs: 5,
    });
    const trace = makeTrace("world", [callEvent, responseEvent]);
    const golden = toGoldenTrace(trace);

    expect(golden.contract.llmEventSequenceHash).toBeDefined();
    expect(typeof golden.contract.llmEventSequenceHash).toBe("string");
    expect(golden.contract.llmEventSequenceHash!.length).toBe(64); // SHA-256 hex
  });

  it("detects changed LLM prompt via sequence hash — pre-fix returns matched:true (finding 3 — pre-fix FAILS)", async () => {
    // Record an agent that asks "compute debit: 10"
    const originalPrompt = "compute debit: 10";
    const callEvent = makeEvent("e1", "llm_call", {
      model: "m",
      promptHash: djb2Hash(originalPrompt),
      prompt: originalPrompt,
    });
    const responseEvent = makeEvent("e2", "llm_response", {
      model: "m",
      response: "ok",
      responseHash: djb2Hash("ok"),
      latencyMs: 5,
    });
    const trace = makeTrace("ok", [callEvent, responseEvent]);
    const golden = toGoldenTrace(trace);

    // Factory v2: same output, same call count, but changed prompt
    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () =>
        AgentUnit.from(async (ctx) => {
          const interceptor = ctx.extensions?.[WEFT_REPLAY_INTERCEPTOR_KEY] as
            | ReplayLLMInterceptor
            | undefined;
          if (interceptor) {
            // Changed prompt — "compute debit: 1000" instead of "compute debit: 10"
            await interceptor.replayCall({ model: "m", prompt: "compute debit: 1000" });
          }
          return "ok"; // same output as recorded
        }),
    });

    // Pre-fix: no sequence check → matched:true (prompt change invisible)
    // Post-fix: sequence hash diverges → matched:false, critical divergence
    expect(matched).toBe(false);
    const seqDiv = divergences.find((d) => d.eventId === "golden:llmEventSequence");
    expect(seqDiv).toBeDefined();
    expect(seqDiv?.severity).toBe("critical");
    expect(seqDiv?.description).toContain("LLM call sequence hash mismatch");
  });

  it("sequence hash matches when the factory uses the same prompt as recorded", async () => {
    const prompt = "compute debit: 10";
    const callEvent = makeEvent("e1", "llm_call", {
      model: "m",
      promptHash: djb2Hash(prompt),
      prompt,
    });
    const responseEvent = makeEvent("e2", "llm_response", {
      model: "m",
      response: "ok",
      responseHash: djb2Hash("ok"),
      latencyMs: 5,
    });
    const trace = makeTrace("ok", [callEvent, responseEvent]);
    const golden = toGoldenTrace(trace);

    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () =>
        AgentUnit.from(async (ctx) => {
          const interceptor = ctx.extensions?.[WEFT_REPLAY_INTERCEPTOR_KEY] as
            | ReplayLLMInterceptor
            | undefined;
          if (interceptor) {
            await interceptor.replayCall({ model: "m", prompt }); // same prompt
          }
          return "ok";
        }),
    });

    expect(matched).toBe(true);
    const seqDiv = divergences.find((d) => d.eventId === "golden:llmEventSequence");
    expect(seqDiv).toBeUndefined();
  });

  it("contract.llmEventSequenceHash is empty-array hash when there are no LLM calls", () => {
    // sha256(JSON.stringify([])) — deterministic, not undefined
    const trace = makeTrace("static-result");
    const golden = toGoldenTrace(trace);
    expect(golden.contract.llmEventSequenceHash).toBeDefined();
    // Value is stable: sha256("[]")
    const expected = sha256hex(JSON.stringify([]));
    expect(golden.contract.llmEventSequenceHash).toBe(expected);
  });
});

describe("replayAgentWithTrace — zero-token guarantee is conditional (finding 2)", () => {
  it("factory that ignores the interceptor produces a critical count-mismatch divergence (loud, not silent)", async () => {
    // Golden recorded one LLM call.
    const callEvent = makeEvent("e1", "llm_call", { model: "m", promptHash: "h" });
    const responseEvent = makeEvent("e2", "llm_response", {
      response: "recorded",
      responseHash: "rh",
      latencyMs: 10,
    });
    const trace = makeTrace("recorded", [callEvent, responseEvent]);
    const golden = toGoldenTrace(trace);

    // Factory produces the expected output by direct value — never touches the
    // interceptor, so callsConsumed=0 vs expectedLlmCallCount=1.
    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory: () => AgentUnit.of("recorded"),
    });

    // 0 consumed ≠ 1 expected → critical divergence (loud, not silent)
    expect(matched).toBe(false);
    const countDiv = divergences.find((d) => d.eventId === "golden:llmCallCount");
    expect(countDiv).toBeDefined();
    expect(countDiv?.severity).toBe("critical");
    expect(countDiv?.expected).toBe(1);
    expect(countDiv?.actual).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent call pairing — events from parallel agents paired by agentId
//
// Pre-fix: extractLLMCallsFromTrace used a single `pending` slot. An interleaved
// sequence (callA → callB → responseA → responseB from two different agents)
// overwrote callA's slot with callB, paired responseA with callB's config, and
// discarded responseB entirely. This is the exact event pattern produced by
// zipAll, consensus, and debate — unchanged parallel code reported spurious
// divergence.
//
// Post-fix: a Map<agentId, Partial<RecordedLLMCall>> is used instead of a
// single slot, correctly pairing each response to its own agent's pending call.
//
// Rule 015: the interleaved-sequence test FAILS pre-fix (returns 1 call, wrong
// pairing) and PASSES post-fix (returns 2 correctly paired calls).
// ─────────────────────────────────────────────────────────────────────────────

describe("extractLLMCallsFromTrace — concurrent call pairing by agentId (finding 3)", () => {
  it("correctly pairs interleaved calls from two parallel agents — pre-fix FAILS", () => {
    // Interleaving: callA (agent-1) → callB (agent-2) → responseA (agent-1) → responseB (agent-2)
    // Pre-fix: callB overwrites callA in single pending slot; only 1 (wrong) pair extracted.
    // Post-fix: Map by agentId; 2 correctly paired calls extracted.
    const events: TraceEvent[] = [
      makeAgentEvent("e1", "agent-1", "llm_call", {
        model: "m1",
        promptHash: "h1",
        prompt: "prompt-A",
      }),
      makeAgentEvent("e2", "agent-2", "llm_call", {
        model: "m2",
        promptHash: "h2",
        prompt: "prompt-B",
      }),
      makeAgentEvent("e3", "agent-1", "llm_response", {
        response: "resp-A",
        responseHash: "rh1",
        latencyMs: 10,
      }),
      makeAgentEvent("e4", "agent-2", "llm_response", {
        response: "resp-B",
        responseHash: "rh2",
        latencyMs: 10,
      }),
    ];
    const calls = extractLLMCallsFromTrace(makeTrace("out", events));

    // Must return 2 calls (pre-fix returns 1, which is wrong)
    expect(calls).toHaveLength(2);

    // agent-1's call must be paired with agent-1's response
    const callA = calls.find((c) => c.config.model === "m1");
    expect(callA).toBeDefined();
    expect(callA?.response.response).toBe("resp-A");

    // agent-2's call must be paired with agent-2's response (pre-fix discards this entirely)
    const callB = calls.find((c) => c.config.model === "m2");
    expect(callB).toBeDefined();
    expect(callB?.response.response).toBe("resp-B");
  });

  it("sequential calls from the same agent still pair correctly after fix", () => {
    // Regression guard: the agentId-keyed approach must not break sequential same-agent calls.
    const events: TraceEvent[] = [
      makeAgentEvent("e1", "agent-1", "llm_call", { model: "m", promptHash: "h1", prompt: "p1" }),
      makeAgentEvent("e2", "agent-1", "llm_response", {
        response: "r1",
        responseHash: "rh1",
        latencyMs: 5,
      }),
      makeAgentEvent("e3", "agent-1", "llm_call", { model: "m", promptHash: "h2", prompt: "p2" }),
      makeAgentEvent("e4", "agent-1", "llm_response", {
        response: "r2",
        responseHash: "rh2",
        latencyMs: 5,
      }),
    ];
    const calls = extractLLMCallsFromTrace(makeTrace("out", events));
    expect(calls).toHaveLength(2);
    expect(calls[0].response.response).toBe("r1");
    expect(calls[1].response.response).toBe("r2");
  });
});
