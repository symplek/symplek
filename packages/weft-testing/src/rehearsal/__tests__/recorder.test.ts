/**
 * @fileoverview Unit tests for Trace Recorder
 * @module weft-core/rehearsal/__tests__/recorder
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceRecorder } from "../recorder";

describe("TraceRecorder", () => {
  let recorder: TraceRecorder;

  beforeEach(() => {
    recorder = new TraceRecorder();
  });

  describe("constructor", () => {
    it("should create with default options", () => {
      expect(recorder).toBeDefined();
      expect(recorder.getEventCount()).toBe(0);
      expect(recorder.getCheckpointCount()).toBe(0);
    });

    it("should accept custom options", () => {
      const customRecorder = new TraceRecorder({
        includePrompts: true,
        checkpointInterval: 50,
      });
      expect(customRecorder).toBeDefined();
    });
  });

  describe("setAgentId / getAgentId", () => {
    it("should default to anonymous", () => {
      expect(recorder.getAgentId()).toBe("anonymous");
    });

    it("should set and get agent ID", () => {
      recorder.setAgentId("my-agent");
      expect(recorder.getAgentId()).toBe("my-agent");
    });
  });

  describe("setOperatorChain", () => {
    it("should set operator chain", () => {
      recorder.setOperatorChain(["map", "flatMap", "consensus"]);

      const trace = recorder.finalize("result");
      expect(trace.metadata.operatorChain).toEqual([
        "map",
        "flatMap",
        "consensus",
      ]);
    });
  });

  describe("appendEvent", () => {
    it("should append event with auto-generated fields", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "map", durationMs: 10 },
      });

      expect(recorder.getEventCount()).toBe(1);
    });

    it("should increment vector clock for agent", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "map", durationMs: 10 },
      });

      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "flatMap", durationMs: 20 },
      });

      const trace = recorder.finalize("result");
      expect(trace.events[0].vectorClock["agent-1"]).toBe(1);
      expect(trace.events[1].vectorClock["agent-1"]).toBe(2);
    });

    it("should throw if trace is finalized", () => {
      recorder.finalize("result");

      expect(() =>
        recorder.appendEvent({
          type: "operator",
          agentId: "agent-1",
          payload: { operator: "test", durationMs: 10 },
        }),
      ).toThrow("Cannot append event to finalized trace");
    });

    it("should generate unique event IDs", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "test", durationMs: 10 },
      });
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize("result");
      expect(trace.events[0].id).not.toBe(trace.events[1].id);
    });

    it("should compute hash for each event", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize("result");
      expect(trace.events[0].hash).toBeDefined();
      expect(trace.events[0].hash.length).toBe(8); // DJB2 hash length
    });
  });

  describe("createCheckpoint", () => {
    it("should create checkpoint with state", () => {
      const state = { counter: 42, data: [1, 2, 3] };
      const checkpointId = recorder.createCheckpoint(state);

      expect(checkpointId).toBeDefined();
      expect(checkpointId).toMatch(/^chk_/);
      expect(recorder.getCheckpointCount()).toBe(1);
    });

    it("should record checkpoint event", () => {
      recorder.createCheckpoint({ value: 1 });

      // Checkpoint creates an event
      expect(recorder.getEventCount()).toBe(1);

      const trace = recorder.finalize("result");
      expect(trace.events[0].type).toBe("checkpoint");
    });

    it("should deep clone state", () => {
      const state = { nested: { value: 1 } };
      recorder.createCheckpoint(state);

      // Modify original
      state.nested.value = 999;

      const trace = recorder.finalize("result");
      expect((trace.checkpoints[0].state as typeof state).nested.value).toBe(1);
    });

    it("should throw if trace is finalized", () => {
      recorder.finalize("result");
      expect(() => recorder.createCheckpoint({ x: 1 })).toThrow(
        "Cannot create checkpoint in finalized trace",
      );
    });
  });

  describe("finalize", () => {
    it("should create valid execution trace", () => {
      recorder.setAgentId("test-agent");
      recorder.appendEvent({
        type: "agent_start",
        agentId: "test-agent",
        payload: { agentId: "test-agent" },
      });

      const trace = recorder.finalize({ result: "success" });

      expect(trace.id).toBeDefined();
      expect(trace.version).toBe("1.0.0");
      expect(trace.startTime).toBeLessThanOrEqual(trace.endTime);
      expect(trace.events).toHaveLength(1);
      expect(trace.finalOutput).toEqual({ result: "success" });
    });

    it("should compute metadata", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "test", durationMs: 10 },
      });
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-2",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize("result");

      expect(trace.metadata.agentCount).toBe(2);
      expect(trace.metadata.eventCount).toBe(2);
      expect(trace.metadata.durationMs).toBeGreaterThanOrEqual(0);
      expect(trace.metadata.schemaVersion).toBe("1.0.0");
    });

    it("should throw if called twice", () => {
      recorder.finalize("first");
      expect(() => recorder.finalize("second")).toThrow(
        "Trace already finalized",
      );
    });

    it("should freeze events array", () => {
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize("result");
      expect(Object.isFrozen(trace.events)).toBe(true);
    });
  });

  describe("redaction", () => {
    it("should redact patterns from payload", () => {
      const recorderWithRedact = new TraceRecorder({
        redactPatterns: [/secret-[0-9]+/g, /api-key-\w+/g],
      });

      recorderWithRedact.appendEvent({
        type: "llm_call",
        agentId: "agent-1",
        payload: {
          model: "gpt-4",
          prompt: "Use secret-12345 with api-key-abc123",
          promptHash: "hash",
        },
      });

      const trace = recorderWithRedact.finalize("result");
      const payload = trace.events[0].payload as { prompt?: string };

      expect(payload.prompt).toContain("[REDACTED]");
      expect(payload.prompt).not.toContain("secret-12345");
    });
  });

  describe("interceptor management", () => {
    it("should install interceptor", () => {
      const mockInterceptor = {
        name: "test",
        install: vi.fn(),
        uninstall: vi.fn(),
        intercept: vi.fn(),
      };

      recorder.installInterceptor(mockInterceptor);
      expect(mockInterceptor.install).toHaveBeenCalledWith(recorder);
    });

    it("should uninstall interceptors on finalize", () => {
      const mockInterceptor = {
        name: "test",
        install: vi.fn(),
        uninstall: vi.fn(),
        intercept: vi.fn(),
      };

      recorder.installInterceptor(mockInterceptor);
      recorder.finalize("result");

      expect(mockInterceptor.uninstall).toHaveBeenCalled();
    });
  });
});
