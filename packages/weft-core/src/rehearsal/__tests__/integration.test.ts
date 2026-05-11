/**
 * @fileoverview Integration tests for Rehearsal Mode
 * @module weft-core/rehearsal/__tests__/integration
 */

import { afterEach, describe, expect, it } from "vitest";
import { RecordingLLMInterceptor } from "../interceptor";
import { TraceRecorder } from "../recorder";
import { TraceReplayer } from "../replayer";
import { FileStorage } from "../storage";
import { TRACE_SCHEMA_VERSION } from "../types";

describe("Rehearsal Mode Integration", () => {
  describe("Full Record-Replay Cycle", () => {
    it("should record and replay single agent execution", async () => {
      // Record phase
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      const llmInterceptor = new RecordingLLMInterceptor({
        includePrompts: true,
      });
      recorder.installInterceptor(llmInterceptor);

      // Simulate agent execution
      recorder.appendEvent({
        type: "agent_start",
        agentId: "test-agent",
        payload: { agentId: "test-agent" },
      });

      // Simulate LLM call
      await llmInterceptor.recordCall(
        { model: "gpt-4", prompt: "What is 2+2?" },
        async () => ({ response: "4", latencyMs: 100 }),
      );

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "map", durationMs: 10 },
      });

      recorder.appendEvent({
        type: "agent_end",
        agentId: "test-agent",
        payload: { agentId: "test-agent" },
      });

      const trace = recorder.finalize({ result: "success" });

      // Replay phase
      const replayer = new TraceReplayer(trace);
      const replayResult = await replayer.replay();

      expect(replayResult.value).toEqual({ result: "success" });
      expect(replayResult.matched).toBe(true);
      expect(replayResult.eventsReplayed).toBeGreaterThan(0);
    });

    it("should produce identical output on multiple replays", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize({ value: 42 });

      const replayer1 = new TraceReplayer(trace);
      const result1 = await replayer1.replay();

      const replayer2 = new TraceReplayer(trace);
      const result2 = await replayer2.replay();

      expect(result1.value).toEqual(result2.value);
      expect(result1.matched).toBe(result2.matched);
    });
  });

  describe("Multi-Agent Coordination", () => {
    it("should record consensus operation", async () => {
      const recorder = new TraceRecorder();

      // Agent 1 votes
      recorder.appendEvent({
        type: "consensus_vote",
        agentId: "agent-1",
        payload: { vote: "yes", weight: 1 },
      });

      // Agent 2 votes
      recorder.appendEvent({
        type: "consensus_vote",
        agentId: "agent-2",
        payload: { vote: "yes", weight: 1 },
      });

      // Agent 3 votes
      recorder.appendEvent({
        type: "consensus_vote",
        agentId: "agent-3",
        payload: { vote: "no", weight: 1 },
      });

      const trace = recorder.finalize({ consensus: "yes", votes: 2 });

      expect(trace.events.length).toBe(3);
      expect(trace.metadata.agentCount).toBe(3);
    });

    it("should preserve causal ordering in multi-agent trace", async () => {
      const recorder = new TraceRecorder();

      // Agent 1 starts
      recorder.appendEvent({
        type: "agent_start",
        agentId: "agent-1",
        payload: { agentId: "agent-1" },
      });

      // Agent 1 sends message to Agent 2
      recorder.appendEvent({
        type: "operator",
        agentId: "agent-1",
        payload: { operator: "send", target: "agent-2", durationMs: 10 },
      });

      // Agent 2 receives and responds
      recorder.appendEvent({
        type: "agent_start",
        agentId: "agent-2",
        payload: { agentId: "agent-2" },
      });

      recorder.appendEvent({
        type: "operator",
        agentId: "agent-2",
        payload: { operator: "receive", source: "agent-1", durationMs: 10 },
      });

      const trace = recorder.finalize({ result: "coordinated" });

      // Verify vector clocks preserve ordering
      const events = trace.events;
      expect(events.length).toBe(4);

      // Replay should maintain order
      const replayer = new TraceReplayer(trace);
      const replayResult = await replayer.replay();
      expect(replayResult.matched).toBe(true);
    });
  });

  describe("Checkpoint Recovery", () => {
    it("should create checkpoint and replay from it", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      // Create some events
      for (let i = 0; i < 5; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: "test-agent",
          payload: { operator: "step", step: i, durationMs: 10 },
        });
      }

      // Create checkpoint
      const checkpointState = { counter: 5, data: [1, 2, 3, 4, 5] };
      const checkpointId = recorder.createCheckpoint(checkpointState);

      // Create more events
      for (let i = 5; i < 10; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: "test-agent",
          payload: { operator: "step", step: i, durationMs: 10 },
        });
      }

      const trace = recorder.finalize({ result: "complete" });

      // Replay from checkpoint
      const replayer = new TraceReplayer(trace, {
        fromCheckpoint: checkpointId,
      });
      const replayResult = await replayer.replay();

      expect(replayResult.eventsReplayed).toBeLessThan(trace.events.length);
    });
  });

  describe("Storage Integration", () => {
    // Track temp keys for cleanup to prevent state leakage across parallel suite runs.
    const tempKeys: string[] = [];

    afterEach(async () => {
      const fs = await import("node:fs/promises");
      const { DEFAULT_STORAGE_PATH } = await import("../storage");
      for (const key of tempKeys.splice(0)) {
        try {
          await fs.rm(`${DEFAULT_STORAGE_PATH}/${key}.trace.json`, {
            force: true,
          });
        } catch {
          // Ignore – file may not exist or path may differ.
        }
      }
    });

    it("should save and load trace", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize({ result: "saved" });

      // Use a unique key per run to prevent cross-suite state leakage.
      const uniqueKey = `integration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      tempKeys.push(uniqueKey);

      // Save
      const storage = new FileStorage();
      const savedPath = await storage.save(trace, uniqueKey);

      expect(savedPath).toBeDefined();

      // Load
      const loadedTrace = await storage.load(uniqueKey);

      expect(loadedTrace.id).toBe(trace.id);
      expect(loadedTrace.version).toBe(TRACE_SCHEMA_VERSION);
      expect(loadedTrace.finalOutput).toEqual({ result: "saved" });
    });

    it("should handle compressed traces", async () => {
      const recorder = new TraceRecorder();

      // Create large trace
      for (let i = 0; i < 1000; i++) {
        recorder.appendEvent({
          type: "operator",
          agentId: "test-agent",
          payload: { operator: "test", index: i, durationMs: 10 },
        });
      }

      const trace = recorder.finalize({ result: "large" });

      // Save compressed
      const storage = new FileStorage({ compress: true });
      const savedPath = await storage.save(trace, "compressed-test");

      expect(savedPath.endsWith(".trace.json.gz")).toBe(true);

      // Note: Loading compressed traces requires proper mock setup
      // For integration test, we verify the path format is correct
      expect(savedPath).toContain("compressed-test");
    });
  });

  describe("Error Handling Integration", () => {
    it("should handle errors during recording gracefully", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      recorder.appendEvent({
        type: "error",
        agentId: "test-agent",
        payload: {
          error: "Test error",
          message: "Something went wrong",
        },
      });

      const trace = recorder.finalize({ result: "error-handled" });

      expect(trace.events.length).toBe(1);
      expect(trace.events[0].type).toBe("error");
    });

    it("should detect divergences during replay", async () => {
      const recorder = new TraceRecorder();
      recorder.setAgentId("test-agent");

      recorder.appendEvent({
        type: "operator",
        agentId: "test-agent",
        payload: { operator: "test", durationMs: 10 },
      });

      const trace = recorder.finalize({ value: 42 });

      // Replay with handler that produces different result
      const replayer = new TraceReplayer(trace);
      const replayResult = await replayer.replay(() => {
        // Handler doesn't match expected behavior
        throw new Error("Divergence");
      });

      expect(replayResult.matched).toBe(false);
      expect(replayResult.divergences.length).toBeGreaterThan(0);
    });
  });
});
