/**
 * @fileoverview Tests for golden trace format (CR-501)
 * @module weft-core/rehearsal/__tests__/golden
 * @description Covers: toGoldenTrace contract, replayAgentWithTrace matched/diverged paths,
 *   schema migration, secret redaction, zero-LLM-call guarantee, and TraceVersionError.
 */

import { createHash } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { AgentUnit } from "../../AgentUnit/AgentUnit";
import {
  _clearMigrationsForTest,
  extractLLMCallsFromTrace,
  GoldenTrace,
  registerTraceMigration,
  replayAgentWithTrace,
  toGoldenTrace,
} from "../golden";
import type { ExecutionTrace, TraceEvent } from "../types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "../types";

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
    expect(golden.events).toBe(trace.events);
  });

  describe("secret redaction", () => {
    it("redacts secrets from finalOutput and recomputes hash from redacted value", () => {
      const trace = makeTrace("api-key=sk-secret123 result");
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z0-9]+/gi],
      });

      // finalOutput should contain REDACTED
      expect(String(golden.finalOutput)).toContain("[REDACTED]");
      expect(String(golden.finalOutput)).not.toContain("sk-secret123");

      // hash is computed from the REDACTED value
      const expectedHash = sha256hex(JSON.stringify(golden.finalOutput));
      expect(golden.contract.finalOutputHash).toBe(expectedHash);
    });

    it("does not mutate the original trace", () => {
      const trace = makeTrace("sk-original");
      toGoldenTrace(trace, { redactPatterns: [/sk-[a-z0-9]+/gi] });
      expect(trace.finalOutput).toBe("sk-original");
    });

    it("handles non-string finalOutput with object redaction", () => {
      const trace = makeTrace({ token: "Bearer sk-secret", user: "alice" });
      const golden = toGoldenTrace(trace, {
        redactPatterns: [/sk-[a-z0-9]+/gi],
      });
      // Redacted JSON should have parsed back to an object
      const out = golden.finalOutput as { token: string; user: string };
      expect(out.token).toContain("[REDACTED]");
      expect(out.user).toBe("alice");
    });
  });
});

// ─── replayAgentWithTrace ─────────────────────────────────────────────────────

describe("replayAgentWithTrace", () => {
  // factory is a type witness; the actual computation isn't called during replay
  const factory = () => AgentUnit.of("unused");

  it("returns matched: true and empty divergences when golden trace is unchanged", async () => {
    const trace = makeTrace("response-a", [makeEvent("e1")]);
    const golden = toGoldenTrace(trace);

    const { matched, divergences } = await replayAgentWithTrace({
      trace: golden,
      factory,
    });

    expect(matched).toBe(true);
    expect(divergences).toHaveLength(0);
  });

  it("returns matched: false when finalOutput has been altered (different agent response)", async () => {
    const trace = makeTrace("response-a", [makeEvent("e1")]);
    const golden = toGoldenTrace(trace);

    // Simulate: agent now produces "response-b" — finalOutput differs from recorded
    const alteredTrace: GoldenTrace<string> = {
      ...golden,
      finalOutput: "response-b",
      // contract still references "response-a" hash
    };

    const { matched, divergences } = await replayAgentWithTrace({
      trace: alteredTrace,
      factory,
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
    const altered: GoldenTrace<string> = { ...golden, finalOutput: "changed" };

    const { divergences } = await replayAgentWithTrace({ trace: altered, factory });

    const div = divergences.find((d) => d.eventId === "golden:finalOutputHash");
    expect(div?.description).toMatch(/\w{16}…/); // SHA-256 prefix present
  });

  it("detects LLM call count mismatch", async () => {
    const events = [
      makeEvent("e1", "llm_call", { model: "m", promptHash: "h" }),
    ];
    const trace = makeTrace("out", events);
    const golden = toGoldenTrace(trace);

    // Simulate trace that has different event count for testing (bypass event integrity)
    // by creating a fresh golden with no llm_call events but same contract
    const alteredGolden: GoldenTrace<string> = {
      ...golden,
      events: [],
      contract: {
        ...golden.contract,
        // Keep expectedLlmCallCount at 1 but events array is now empty
        finalOutputHash: sha256hex(JSON.stringify(golden.finalOutput)),
      },
      metadata: { ...golden.metadata, eventCount: 0 },
    };

    const { matched, divergences } = await replayAgentWithTrace({
      trace: alteredGolden,
      factory,
    });

    expect(matched).toBe(false);
    const countDiv = divergences.find((d) => d.eventId === "golden:llmCallCount");
    expect(countDiv).toBeDefined();
    expect(countDiv?.description).toContain("LLM call count mismatch");
  });

  it("result is a genuine TrackedResult", async () => {
    const trace = makeTrace("ok");
    const golden = toGoldenTrace(trace);

    const { result } = await replayAgentWithTrace({ trace: golden, factory });

    expect(result).toBeDefined();
    expect(result.value).toBe("ok");
    expect(result.source).toBe("agent");
    expect(result.confidence).toBe(1);
  });

  it("result.confidence is 0 when matched is false", async () => {
    const trace = makeTrace("a");
    const golden = toGoldenTrace(trace);
    const altered: GoldenTrace<string> = { ...golden, finalOutput: "b" };

    const { result, matched } = await replayAgentWithTrace({ trace: altered, factory });

    expect(matched).toBe(false);
    expect(result.confidence).toBe(0);
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
        replayAgentWithTrace({ trace: staleGolden as GoldenTrace<string>, factory }),
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
        await replayAgentWithTrace({ trace: staleGolden as GoldenTrace<string>, factory });
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

      // Register migration from 0.9.0 to current
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
        factory,
      });
      // matched may be false if contract misaligns after migration, but no error thrown
      expect(typeof matched).toBe("boolean");
    });
  });

  describe("zero LLM calls during replay", () => {
    it("does not call the factory unit's computation", async () => {
      let computationCalled = false;
      const throwIfCalled = AgentUnit.from(async () => {
        computationCalled = true;
        throw new Error("Provider called during replay — this must never happen");
      });

      const trace = makeTrace("recorded-output");
      const golden = toGoldenTrace(trace);

      const { matched } = await replayAgentWithTrace({
        trace: golden,
        factory: () => throwIfCalled,
      });

      expect(computationCalled).toBe(false);
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
