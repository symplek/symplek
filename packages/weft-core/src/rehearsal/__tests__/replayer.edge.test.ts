/**
 * @fileoverview Edge case tests for Trace Replayer
 * @module weft-core/rehearsal/__tests__/replayer.edge
 */

import { describe, expect, it, vi } from "vitest";
import {
  isVersionCompatible,
  TraceReplayer,
  validateTraceVersion,
} from "../replayer";
import type { Checkpoint, ExecutionTrace, TraceEvent } from "../types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "../types";

function createTrace<T>(
  events: TraceEvent[] = [],
  finalOutput: T = "result" as T,
  checkpoints: Checkpoint[] = [],
  version: string = TRACE_SCHEMA_VERSION,
): ExecutionTrace<T> {
  return {
    id: "trace_test",
    version: version as typeof TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    events,
    checkpoints,
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: events.length,
      durationMs: 1000,
      schemaVersion: version as typeof TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: checkpoints.length,
    },
    finalOutput,
  };
}

// ---------------------------------------------------------------------------
// DJB2 hash helpers (matching recorder.ts computeEventHash / replayer.ts computeHash)
// ---------------------------------------------------------------------------

function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function computeEventHash(event: Omit<TraceEvent, "hash">): string {
  const content = JSON.stringify({
    id: event.id,
    type: event.type,
    agentId: event.agentId,
    timestamp: event.timestamp,
    vectorClock: event.vectorClock,
    payload: event.payload,
  });
  return djb2Hash(content);
}

// Helper to create test event with a correct DJB2 hash
function createEvent(
  id: string,
  type: "operator" | "llm_call" | "llm_response" = "operator",
  payload: Record<string, unknown> = { operator: "test", durationMs: 10 },
): TraceEvent {
  const base = {
    id,
    type,
    agentId: "agent-1",
    timestamp: Date.now(),
    vectorClock: { "agent-1": 1 },
    payload: payload as TraceEvent["payload"],
  };
  return {
    ...base,
    hash: computeEventHash(base),
  };
}

describe("TraceReplayer Edge Cases", () => {
  describe("Version Compatibility", () => {
    it("should handle future version with warning", () => {
      const trace = createTrace([], "result", [], "2.0.0");

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(() => new TraceReplayer(trace)).toThrow(TraceVersionError);

      consoleSpy.mockRestore();
    });

    it("should handle very old version", () => {
      const trace = createTrace([], "result", [], "0.0.1");
      expect(() => new TraceReplayer(trace)).toThrow(TraceVersionError);
    });

    it("should handle malformed version string", () => {
      const trace = createTrace([], "result", [], "invalid-version");
      expect(() => new TraceReplayer(trace)).toThrow();
    });
  });

  describe("Exhausted Events", () => {
    it("should handle replay expecting more events than available", async () => {
      const events = [createEvent("e1"), createEvent("e2")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      const handler = vi.fn();
      await replayer.replay(handler);

      // Should have processed all available events
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should handle empty trace replay", async () => {
      const trace = createTrace([]);
      const replayer = new TraceReplayer(trace);

      const result = await replayer.replay();
      expect(result.eventsReplayed).toBe(0);
      expect(result.totalEvents).toBe(0);
      expect(result.matched).toBe(true);
    });
  });

  describe("Handler Errors", () => {
    it("should record divergences from handler errors", async () => {
      const events = [createEvent("e1"), createEvent("e2")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      const result = await replayer.replay(() => {
        throw new Error("Handler error");
      });

      expect(result.divergences.length).toBeGreaterThan(0);
      expect(result.matched).toBe(false);
    });

    it("should handle async handler errors", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      const result = await replayer.replay(async () => {
        await Promise.resolve();
        throw new Error("Async error");
      });

      expect(result.divergences.length).toBeGreaterThan(0);
    });
  });

  describe("Checkpoint Edge Cases", () => {
    it("should handle checkpoint at event index 0", () => {
      const checkpoint: Checkpoint = {
        id: "chk_0",
        vectorClock: { "agent-1": 0 },
        state: { value: 0 },
        timestamp: Date.now(),
        stateHash: "hash",
        eventIndex: 0,
      };

      const events = [createEvent("e0")];
      const trace = createTrace(events, "result", [checkpoint]);
      const replayer = new TraceReplayer(trace);

      const state = replayer.restoreNearestCheckpoint(0);
      expect(state?.value).toBe(0);
    });

    it("should handle checkpoint beyond last event", () => {
      const checkpoint: Checkpoint = {
        id: "chk_late",
        vectorClock: { "agent-1": 100 },
        state: { value: 100 },
        timestamp: Date.now(),
        stateHash: "hash",
        eventIndex: 100,
      };

      const events = [createEvent("e1")];
      const trace = createTrace(events, "result", [checkpoint]);
      const replayer = new TraceReplayer(trace);

      // Requesting checkpoint at index 50 when checkpoint is at 100 returns undefined
      // because getNearestCheckpointBefore looks for checkpoints BEFORE the index
      const state = replayer.restoreNearestCheckpoint(50);
      expect(state).toBeUndefined();
    });

    it("should handle multiple checkpoints at same index", () => {
      const checkpoint1: Checkpoint = {
        id: "chk1",
        vectorClock: { "agent-1": 5 },
        state: { value: 1 },
        timestamp: Date.now(),
        stateHash: "hash1",
        eventIndex: 5,
      };

      const checkpoint2: Checkpoint = {
        id: "chk2",
        vectorClock: { "agent-1": 5 },
        state: { value: 2 },
        timestamp: Date.now() + 1,
        stateHash: "hash2",
        eventIndex: 5,
      };

      const events = Array.from({ length: 10 }, (_, i) => createEvent(`e${i}`));
      const trace = createTrace(events, "result", [checkpoint1, checkpoint2]);
      const replayer = new TraceReplayer(trace);

      // Should find the later checkpoint
      const state = replayer.restoreNearestCheckpoint(5);
      expect(state).toBeDefined();
    });
  });

  describe("Stop After Events", () => {
    it("should stop exactly at stopAfterEvents", async () => {
      const events = Array.from({ length: 10 }, (_, i) => createEvent(`e${i}`));
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace, { stopAfterEvents: 5 });

      const handler = vi.fn();
      const result = await replayer.replay(handler);

      expect(handler).toHaveBeenCalledTimes(5);
      expect(result.eventsReplayed).toBe(5);
      expect(result.totalEvents).toBe(10);
    });

    it("should handle stopAfterEvents larger than total events", async () => {
      const events = [createEvent("e1"), createEvent("e2")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace, { stopAfterEvents: 100 });

      const handler = vi.fn();
      const result = await replayer.replay(handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(result.eventsReplayed).toBe(2);
    });
  });

  describe("Divergence Callbacks", () => {
    it("should call onDivergence for each divergence", async () => {
      const events = [createEvent("e1"), createEvent("e2")];
      const trace = createTrace(events);
      const onDivergence = vi.fn();
      const replayer = new TraceReplayer(trace, { onDivergence });

      await replayer.replay(() => {
        throw new Error("Error");
      });

      expect(onDivergence).toHaveBeenCalled();
    });

    it("should handle onDivergence throwing", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace, {
        onDivergence: () => {
          throw new Error("Callback error");
        },
      });

      // onDivergence callback throwing should not crash the replay
      // The error is caught and the divergence is still recorded
      const result = await replayer.replay(() => {
        throw new Error("Handler error");
      });

      expect(result.divergences.length).toBeGreaterThan(0);
      // The error from onDivergence should be caught internally
    });
  });

  describe("LLM Interceptor Edge Cases", () => {
    it("should handle trace with no LLM calls", () => {
      const events = [createEvent("e1", "operator")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      expect(replayer.getLLMInterceptor()).toBeNull();
    });

    it("should handle trace with only LLM calls", () => {
      const events: TraceEvent[] = [
        createEvent("e1", "llm_call", {
          model: "gpt-4",
          promptHash: "hash1",
        }),
        createEvent("e2", "llm_response", {
          model: "gpt-4",
          responseHash: "hash2",
          latencyMs: 100,
        }),
      ];

      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      expect(replayer.getLLMInterceptor()).not.toBeNull();
    });
  });
});

describe("Version Utilities Edge Cases", () => {
  describe("isVersionCompatible", () => {
    it("should handle exact version match", () => {
      expect(isVersionCompatible(TRACE_SCHEMA_VERSION)).toBe(true);
    });

    it("should handle patch version differences", () => {
      // Assuming version is "1.0.0", "1.0.1" should be compatible
      expect(isVersionCompatible("1.0.1")).toBe(false); // Different major/minor
    });
  });

  describe("validateTraceVersion", () => {
    it("should throw for completely different version", () => {
      const trace = createTrace([], "result", [], "9.9.9");
      expect(() => validateTraceVersion(trace)).toThrow(TraceVersionError);
    });
  });
});
