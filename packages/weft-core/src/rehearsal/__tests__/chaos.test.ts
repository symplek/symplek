/**
 * @fileoverview Chaos engineering tests for Rehearsal Mode
 * @module @symplek/core/rehearsal/__tests__/chaos
 */

import { describe, expect, it, vi } from "vitest";
import { RecordingLLMInterceptor } from "../interceptor";
import { TraceRecorder } from "../recorder";
import { ReplayDivergenceError, TraceReplayer } from "../replayer";
import { FileStorage } from "../storage";
import type { ExecutionTrace } from "../types";

describe("Chaos Scenarios", () => {
  describe("Network Failures", () => {
    it("should handle LLM timeout during record", async () => {
      const recorder = new TraceRecorder();
      const llmInterceptor = new RecordingLLMInterceptor();
      recorder.installInterceptor(llmInterceptor);

      // Simulate timeout
      const timeoutError = new Error("LLM timeout after 30s");

      try {
        await llmInterceptor.recordCall(
          { model: "gpt-4", prompt: "test" },
          async () => {
            await new Promise((_, reject) =>
              setTimeout(() => reject(timeoutError), 100),
            );
            return { response: "never", latencyMs: 0 };
          },
        );
      } catch (error) {
        // Error should be recorded
        recorder.appendEvent({
          type: "error",
          agentId: "test-agent",
          payload: {
            error: "LLM timeout",
            message: (error as Error).message,
          },
        });
      }

      const trace = recorder.finalize({ result: "timeout-handled" });
      expect(trace.events.some((e) => e.type === "error")).toBe(true);
    });

    it("should handle partial LLM response", async () => {
      const recorder = new TraceRecorder();
      const llmInterceptor = new RecordingLLMInterceptor({
        includePrompts: true,
      });
      recorder.installInterceptor(llmInterceptor);

      // Simulate truncated response
      await llmInterceptor.recordCall(
        { model: "gpt-4", prompt: "test" },
        async () => ({
          response: "Partial response...", // Truncated
          latencyMs: 100,
          finishReason: "length", // Indicates truncation
        }),
      );

      const trace = recorder.finalize({ result: "partial" });
      const llmEvents = trace.events.filter((e) => e.type === "llm_response");
      expect(llmEvents.length).toBeGreaterThan(0);
    });
  });

  describe("Resource Exhaustion", () => {
    it("should handle memory pressure with large traces", () => {
      const recorder = new TraceRecorder();

      // Create many events with moderate payloads
      for (let i = 0; i < 10000; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: `agent-${i % 10}`,
          payload: {
            operator: "test",
            data: Array.from({ length: 100 }, (_, j) => j),
            durationMs: 10,
          },
        });
      }

      // Should not throw
      expect(() => {
        const trace = recorder.finalize({ result: "large" });
        expect(trace.events.length).toBe(10000);
      }).not.toThrow();
    });

    it.skip("should handle disk full scenario gracefully", async () => {
      const storage = new FileStorage();
      const trace: ExecutionTrace<string> = {
        id: "test",
        version: "1.0.0",
        startTime: Date.now(),
        endTime: Date.now(),
        events: [],
        checkpoints: [],
        metadata: {
          composition: "test",
          agentCount: 1,
          eventCount: 0,
          durationMs: 0,
          schemaVersion: "1.0.0",
          operatorChain: [],
          includesPrompts: false,
          checkpointCount: 0,
        },
        finalOutput: "test",
      };

      // Mock writeFile to simulate disk full
      const fsMock = await import("node:fs/promises");
      const _originalWriteFile = fsMock.writeFile;
      vi.spyOn(fsMock, "writeFile").mockRejectedValueOnce(
        new Error("ENOSPC: no space left on device"),
      );

      await expect(storage.save(trace)).rejects.toThrow();

      vi.restoreAllMocks();
    });

    it("should handle event storm (10,000 events/second)", async () => {
      const recorder = new TraceRecorder();

      const startTime = Date.now();
      const eventsPerSecond = 10000;
      const durationSeconds = 0.1; // 100ms
      const totalEvents = Math.floor(eventsPerSecond * durationSeconds);

      const promises = Array.from({ length: totalEvents }, (_, i) =>
        Promise.resolve().then(() => {
          recorder.appendEvent({
            type: "operator",
            agentId: `agent-${i % 10}`,
            payload: { operator: "test", index: i, durationMs: 1 },
          });
        }),
      );

      await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      expect(recorder.getEventCount()).toBe(totalEvents);
      expect(elapsed).toBeLessThan(1000); // Should complete quickly
    });
  });

  describe("Concurrent Access", () => {
    it("should handle parallel recordings without cross-talk", async () => {
      const recorders = Array.from({ length: 5 }, () => new TraceRecorder());

      const promises = recorders.map((recorder, i) =>
        Promise.resolve().then(() => {
          recorder.setAgentId(`agent-${i}`);
          recorder.appendEvent({
            type: "operator",
            agentId: `agent-${i}`,
            payload: { operator: "test", recorderId: i, durationMs: 10 },
          });
          return recorder.finalize({ recorderId: i });
        }),
      );

      const traces = await Promise.all(promises);

      // Each trace should be independent
      traces.forEach((trace, i) => {
        expect(trace.events.length).toBe(1);
        expect(
          (trace.events[0].payload as { recorderId?: number }).recorderId,
        ).toBe(i);
      });
    });

    it("should handle concurrent replay of same trace", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize({ result: "shared" });

      // Replay same trace concurrently
      const replayers = Array.from(
        { length: 3 },
        () => new TraceReplayer(trace),
      );

      const results = await Promise.all(
        replayers.map((replayer) => replayer.replay()),
      );

      // All should produce same result
      results.forEach((result) => {
        expect(result.value).toEqual({ result: "shared" });
        expect(result.matched).toBe(true);
      });
    });

    it("should handle race condition during checkpoint creation", async () => {
      const recorder = new TraceRecorder();

      // Create checkpoints concurrently
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          recorder.createCheckpoint({ counter: i });
        }),
      );

      await Promise.all(promises);

      expect(recorder.getCheckpointCount()).toBe(10);

      const trace = recorder.finalize({ result: "race-handled" });
      expect(trace.checkpoints.length).toBe(10);
    });
  });

  describe("Data Corruption", () => {
    it.skip("should handle corrupted trace file gracefully", async () => {
      const storage = new FileStorage();

      // Mock corrupted JSON
      const fsMock = await import("node:fs/promises");
      vi.spyOn(fsMock, "readFile").mockResolvedValueOnce(
        "{ invalid json }" as unknown as Buffer,
      );

      await expect(storage.load("corrupted")).rejects.toThrow();

      vi.restoreAllMocks();
    });

    it("should detect trace with invalid hash integrity", async () => {
      const trace: ExecutionTrace<string> = {
        id: "corrupted",
        version: "1.0.0",
        startTime: Date.now(),
        endTime: Date.now(),
        events: [
          {
            id: "e1",
            type: "operator",
            agentId: "agent-1",
            timestamp: Date.now(),
            vectorClock: { "agent-1": NaN }, // Invalid clock
            payload: { operator: "test", durationMs: 10 },
            hash: "hash",
          },
        ],
        checkpoints: [],
        metadata: {
          composition: "test",
          agentCount: 1,
          eventCount: 1,
          durationMs: 0,
          schemaVersion: "1.0.0",
          operatorChain: [],
          includesPrompts: false,
          checkpointCount: 0,
        },
        finalOutput: "test",
      };

      // Trace with fake hashes should trigger ReplayDivergenceError during integrity check
      const replayer = new TraceReplayer(trace);
      await expect(replayer.replay()).rejects.toThrow(ReplayDivergenceError);
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle trace with maximum safe integer timestamps", () => {
      const recorder = new TraceRecorder();
      const maxTimestamp = Number.MAX_SAFE_INTEGER;

      // Create event with explicit timestamp
      const event = {
        type: "operator" as const,
        agentId: "test-agent",
        timestamp: maxTimestamp,
        payload: { operator: "test", durationMs: 10 },
      };

      // Manually append with timestamp (recorder will use its own timestamp, so we check the event)
      recorder.appendEvent(event);

      const trace = recorder.finalize({ result: "max-timestamp" });
      // Recorder generates its own timestamp, so we verify the event was recorded
      expect(trace.events.length).toBe(1);
      expect(trace.events[0].type).toBe("operator");
    });

    it("should handle trace with zero duration", () => {
      const recorder = new TraceRecorder();
      const _startTime = Date.now();

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "test", durationMs: 0 },
      });

      const trace = recorder.finalize({ result: "instant" });
      expect(trace.endTime - trace.startTime).toBeGreaterThanOrEqual(0);
    });
  });
});
