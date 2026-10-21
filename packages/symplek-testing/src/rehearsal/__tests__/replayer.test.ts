/**
 * @fileoverview Unit tests for Trace Replayer
 * @module @symplek/core/rehearsal/__tests__/replayer
 */

import { describe, expect, it, vi } from "vitest";
import {
  createReplayer,
  isVersionCompatible,
  replayTrace,
  TraceReplayer,
  validateTraceVersion,
} from "../replayer";
import type { Checkpoint, ExecutionTrace, TraceEvent } from "../types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "../types";

// Helper to create minimal valid trace
function createTrace<T>(
  events: TraceEvent[] = [],
  finalOutput: T = "result" as T,
  checkpoints: Checkpoint[] = [],
): ExecutionTrace<T> {
  return {
    id: "trace_test",
    version: TRACE_SCHEMA_VERSION,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    events,
    checkpoints,
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: events.length,
      durationMs: 1000,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: checkpoints.length,
    },
    finalOutput,
  };
}

// Helper to create test event
function createEvent(
  id: string,
  type: "operator" | "llm_call" | "llm_response" = "operator",
  payload: Record<string, unknown> = { operator: "test", durationMs: 10 },
): TraceEvent {
  return {
    id,
    type,
    agentId: "agent-1",
    timestamp: Date.now(),
    vectorClock: { "agent-1": 1 },
    payload: payload as TraceEvent["payload"],
    hash: `hash_${id}`,
  };
}

describe("Version Checking", () => {
  describe("isVersionCompatible", () => {
    it("should return true for matching version", () => {
      expect(isVersionCompatible(TRACE_SCHEMA_VERSION)).toBe(true);
    });

    it("should return false for different version", () => {
      expect(isVersionCompatible("0.0.1")).toBe(false);
      expect(isVersionCompatible("2.0.0")).toBe(false);
    });
  });

  describe("validateTraceVersion", () => {
    it("should pass for valid version", () => {
      const trace = createTrace();
      expect(() => validateTraceVersion(trace)).not.toThrow();
    });

    it("should throw TraceVersionError for invalid version", () => {
      const trace = {
        ...createTrace(),
        version: "0.0.1" as typeof TRACE_SCHEMA_VERSION,
      };

      expect(() => validateTraceVersion(trace)).toThrow(TraceVersionError);
    });
  });
});

describe("TraceReplayer", () => {
  describe("constructor", () => {
    it("should create replayer from valid trace", () => {
      const trace = createTrace();
      const replayer = new TraceReplayer(trace);
      expect(replayer).toBeDefined();
    });

    it("should throw for incompatible version", () => {
      const trace = {
        ...createTrace(),
        version: "0.0.1" as typeof TRACE_SCHEMA_VERSION,
      };

      expect(() => new TraceReplayer(trace)).toThrow(TraceVersionError);
    });
  });

  describe("replay", () => {
    it("should replay empty trace", async () => {
      const trace = createTrace<string>([], "final");
      const replayer = new TraceReplayer(trace);

      const result = await replayer.replay();

      expect(result.value).toBe("final");
      expect(result.matched).toBe(true);
      expect(result.eventsReplayed).toBe(0);
      expect(result.totalEvents).toBe(0);
      expect(result.divergences).toHaveLength(0);
    });

    it("should call handler for each event", async () => {
      const events = [createEvent("e1"), createEvent("e2"), createEvent("e3")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      const handler = vi.fn();
      await replayer.replay(handler);

      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("should respect stopAfterEvents option", async () => {
      const events = [createEvent("e1"), createEvent("e2"), createEvent("e3")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace, { stopAfterEvents: 2 });

      const handler = vi.fn();
      const result = await replayer.replay(handler);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(result.eventsReplayed).toBe(2);
      expect(result.totalEvents).toBe(3);
    });

    it("should record divergences from errors", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      const result = await replayer.replay(() => {
        throw new Error("Test error");
      });

      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0].severity).toBe("critical");
      expect(result.matched).toBe(false);
    });

    it("should call onDivergence callback", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const onDivergence = vi.fn();
      const replayer = new TraceReplayer(trace, { onDivergence });

      await replayer.replay(() => {
        throw new Error("Test error");
      });

      expect(onDivergence).toHaveBeenCalled();
    });
  });

  describe("getDivergences", () => {
    it("should return recorded divergences", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      await replayer.replay(() => {
        throw new Error("Test error");
      });

      const divergences = replayer.getDivergences();
      expect(divergences).toHaveLength(1);
    });
  });

  describe("skipToCheckpoint", () => {
    it("should skip to checkpoint by ID", () => {
      const checkpoint: Checkpoint = {
        id: "chk_1",
        vectorClock: { "agent-1": 5 },
        state: { counter: 42 },
        timestamp: Date.now(),
        stateHash: "12345678",
        eventIndex: 5,
      };

      const events = Array.from({ length: 10 }, (_, i) => createEvent(`e${i}`));

      const trace = createTrace(events, "result", [checkpoint]);
      const replayer = new TraceReplayer(trace);

      replayer.skipToCheckpoint("chk_1");
      // After skip, should be at event index 5
    });

    it("should throw for unknown checkpoint", () => {
      const trace = createTrace([createEvent("e1")]);
      const replayer = new TraceReplayer(trace);

      expect(() => replayer.skipToCheckpoint("unknown")).toThrow(
        "Checkpoint not found",
      );
    });
  });

  describe("fromCheckpoint option", () => {
    it("should start from checkpoint", async () => {
      const checkpoint: Checkpoint = {
        id: "chk_1",
        vectorClock: { "agent-1": 2 },
        state: { counter: 10 },
        timestamp: Date.now(),
        stateHash: "12345678",
        eventIndex: 2,
      };

      const events = Array.from({ length: 5 }, (_, i) => createEvent(`e${i}`));

      const trace = createTrace(events, "result", [checkpoint]);
      const replayer = new TraceReplayer(trace, { fromCheckpoint: "chk_1" });

      const handler = vi.fn();
      const result = await replayer.replay(handler);

      // Should only replay events after checkpoint (index 2, 3, 4)
      expect(handler).toHaveBeenCalledTimes(3);
      expect(result.eventsReplayed).toBe(3);
    });
  });

  describe("getLLMInterceptor", () => {
    it("should return null for trace without LLM calls", () => {
      const trace = createTrace([createEvent("e1")]);
      const replayer = new TraceReplayer(trace);

      expect(replayer.getLLMInterceptor()).toBeNull();
    });

    it("should create interceptor for trace with LLM calls", () => {
      const events: TraceEvent[] = [
        createEvent("e1", "llm_call", {
          model: "gpt-4",
          promptHash: "hash1",
          prompt: "Hello",
        }),
        createEvent("e2", "llm_response", {
          model: "gpt-4",
          responseHash: "hash2",
          response: "Hi!",
          latencyMs: 100,
        }),
      ];

      const trace = createTrace(events);
      const replayer = new TraceReplayer(trace);

      expect(replayer.getLLMInterceptor()).not.toBeNull();
    });
  });

  describe("getCheckpointManager", () => {
    it("should return checkpoint manager", () => {
      const trace = createTrace();
      const replayer = new TraceReplayer(trace);

      const manager = replayer.getCheckpointManager();
      expect(manager).toBeDefined();
      expect(manager.getCheckpointCount()).toBe(0);
    });
  });

  describe("restoreNearestCheckpoint", () => {
    it("should restore state from nearest checkpoint", () => {
      const checkpoint: Checkpoint = {
        id: "chk_1",
        vectorClock: { "agent-1": 2 },
        state: { counter: 42 },
        timestamp: Date.now(),
        stateHash: "12345678",
        eventIndex: 2,
      };

      const events = Array.from({ length: 5 }, (_, i) => createEvent(`e${i}`));

      const trace = createTrace(events, "result", [checkpoint]);
      const replayer = new TraceReplayer(trace);

      const state = replayer.restoreNearestCheckpoint<{ counter: number }>(4);
      expect(state?.counter).toBe(42);
    });

    it("should return undefined if no checkpoint before index", () => {
      const trace = createTrace([createEvent("e1")]);
      const replayer = new TraceReplayer(trace);

      const state = replayer.restoreNearestCheckpoint(0);
      expect(state).toBeUndefined();
    });
  });
});

describe("Utility Functions", () => {
  describe("createReplayer", () => {
    it("should create replayer instance", () => {
      const trace = createTrace();
      const replayer = createReplayer(trace);
      expect(replayer).toBeInstanceOf(TraceReplayer);
    });
  });

  describe("replayTrace", () => {
    it("should replay and return result", async () => {
      const trace = createTrace<string>([], "final-result");
      const result = await replayTrace(trace);

      expect(result.value).toBe("final-result");
      expect(result.matched).toBe(true);
    });

    it("should accept optional handler", async () => {
      const events = [createEvent("e1")];
      const trace = createTrace(events);
      const handler = vi.fn();

      await replayTrace(trace, handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
