/**
 * @fileoverview Edge case tests for Trace Recorder
 * @module weft-core/rehearsal/__tests__/recorder.edge
 */

import { describe, expect, it } from "vitest";
import { TraceRecorder } from "../recorder";

describe("TraceRecorder Edge Cases", () => {
  describe("Memory Pressure", () => {
    it("should handle recording 10,000 events", () => {
      const recorder = new TraceRecorder();

      for (let i = 0; i < 10000; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: `agent-${i % 10}`,
          payload: { operator: "test", durationMs: 10 },
        });
      }

      expect(recorder.getEventCount()).toBe(10000);
      const trace = recorder.finalize("result");
      expect(trace.events).toHaveLength(10000);
    });

    it("should handle very large payloads", () => {
      const recorder = new TraceRecorder();
      const largePayload = {
        operator: "test",
        data: "x".repeat(1000000), // 1MB string
        durationMs: 10,
      };

      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: largePayload,
      });

      const trace = recorder.finalize("result");
      expect(trace.events[0].payload).toBeDefined();
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle rapid event appends", async () => {
      const recorder = new TraceRecorder();

      const promises = Array.from({ length: 1000 }, (_, _i) =>
        Promise.resolve().then(() => {
          recorder.appendEvent({
            type: "operator",
            agentId: "agent-1",
            payload: { operator: "test", durationMs: 10 },
          });
        }),
      );

      await Promise.all(promises);
      expect(recorder.getEventCount()).toBe(1000);
    });
  });

  describe("Redaction Edge Cases", () => {
    it("should handle multiple overlapping patterns", () => {
      const recorder = new TraceRecorder({
        includePrompts: true,
        redactPatterns: [/secret-\d+/g, /api-key-\w+/g],
      });

      recorder.appendEvent({
        type: "llm_call",
        agentId: "agent-1",
        payload: {
          model: "gpt-4",
          prompt: "Use secret-12345 with api-key-abc123 and secret-67890",
          promptHash: "hash",
        },
      });

      const trace = recorder.finalize("result");
      const prompt =
        (trace.events[0].payload as { prompt?: string }).prompt || "";
      expect(prompt).toContain("[REDACTED]");
      expect(prompt).not.toContain("secret-12345");
      expect(prompt).not.toContain("api-key-abc123");
    });

    it("should handle empty redaction patterns", () => {
      const recorder = new TraceRecorder({
        includePrompts: true,
        redactPatterns: [],
      });

      recorder.appendEvent({
        type: "llm_call",
        agentId: "agent-1",
        payload: {
          model: "gpt-4",
          prompt: "Secret: secret-12345",
          promptHash: "hash",
        },
      });

      const trace = recorder.finalize("result");
      const prompt =
        (trace.events[0].payload as { prompt?: string }).prompt || "";
      expect(prompt).toContain("secret-12345");
    });
  });

  describe("Checkpoint Edge Cases", () => {
    it("should handle very large checkpoint states", () => {
      const recorder = new TraceRecorder();
      const largeState = {
        data: Array.from({ length: 100000 }, (_, i) => ({
          id: i,
          value: i * 2,
        })),
      };

      const checkpointId = recorder.createCheckpoint(largeState);
      expect(checkpointId).toBeDefined();

      const trace = recorder.finalize("result");
      expect(trace.checkpoints).toHaveLength(1);
      expect(trace.checkpoints[0].state).toBeDefined();
    });

    it("should handle checkpoint with circular references (should throw)", () => {
      const recorder = new TraceRecorder();
      const state: Record<string, unknown> = { value: 1 };
      state.self = state; // Circular reference

      // JSON.stringify will fail on circular references
      expect(() => {
        recorder.createCheckpoint(state);
      }).toThrow();
    });

    it("should handle many checkpoints", () => {
      const recorder = new TraceRecorder();

      for (let i = 0; i < 1000; i++) {
        recorder.createCheckpoint({ counter: i });
      }

      expect(recorder.getCheckpointCount()).toBe(1000);
      const trace = recorder.finalize("result");
      expect(trace.checkpoints).toHaveLength(1000);
    });
  });

  describe("Finalization Edge Cases", () => {
    it("should handle finalization with empty events", () => {
      const recorder = new TraceRecorder();
      const trace = recorder.finalize("result");

      expect(trace.events).toHaveLength(0);
      expect(trace.finalOutput).toBe("result");
    });

    it("should handle finalization with complex output", () => {
      const recorder = new TraceRecorder();
      const complexOutput = {
        nested: {
          array: [1, 2, { deep: "value" }],
          map: new Map([["key", "value"]]),
        },
      };

      const trace = recorder.finalize(complexOutput);
      expect(trace.finalOutput).toEqual(complexOutput);
    });

    it("should prevent double finalization", () => {
      const recorder = new TraceRecorder();
      recorder.finalize("first");

      expect(() => recorder.finalize("second")).toThrow(
        "Trace already finalized",
      );
    });
  });

  describe("Agent ID Edge Cases", () => {
    it("should handle empty agent ID", () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("");
      expect(recorder.getAgentId()).toBe("");
    });

    it("should handle very long agent IDs", () => {
      const recorder = new TraceRecorder();
      const longId = "a".repeat(10000);
      recorder.setAgentId(longId);
      expect(recorder.getAgentId()).toBe(longId);
    });

    it("should handle special characters in agent IDs", () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("agent@#$%^&*()");
      expect(recorder.getAgentId()).toBe("agent@#$%^&*()");
    });
  });

  describe("Event ID Uniqueness", () => {
    it("should generate unique IDs even with rapid appends", () => {
      const recorder = new TraceRecorder();
      const ids = new Set<string>();

      for (let i = 0; i < 10000; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: "agent-1",
          payload: { operator: "test", durationMs: 10 },
        });
      }

      const trace = recorder.finalize("result");
      trace.events.forEach((event) => {
        expect(ids.has(event.id)).toBe(false);
        ids.add(event.id);
      });

      expect(ids.size).toBe(10000);
    });
  });
});
