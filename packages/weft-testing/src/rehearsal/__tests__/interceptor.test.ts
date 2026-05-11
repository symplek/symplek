/**
 * @fileoverview Unit tests for LLM Interceptors
 * @module @weft/core/rehearsal/__tests__/interceptor
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type InterceptorRecorder,
  type LLMCallConfig,
  type LLMCallResponse,
  type RecordedLLMCall,
  RecordingLLMInterceptor,
  ReplayLLMInterceptor,
} from "../interceptor";

// Mock recorder for testing
function createMockRecorder(): InterceptorRecorder & {
  events: Array<{ type: string; payload: unknown }>;
} {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    events,
    appendEvent: vi.fn((event) => {
      events.push({ type: event.type, payload: event.payload });
    }),
    getAgentId: vi.fn().mockReturnValue("test-agent"),
  };
}

describe("RecordingLLMInterceptor", () => {
  let interceptor: RecordingLLMInterceptor;
  let mockRecorder: ReturnType<typeof createMockRecorder>;

  beforeEach(() => {
    interceptor = new RecordingLLMInterceptor();
    mockRecorder = createMockRecorder();
  });

  describe("name", () => {
    it("should have name 'llm'", () => {
      expect(interceptor.name).toBe("llm");
    });
  });

  describe("install / uninstall", () => {
    it("should install with recorder", () => {
      interceptor.install(mockRecorder);
      // No errors means success
    });

    it("should uninstall cleanly", () => {
      interceptor.install(mockRecorder);
      interceptor.uninstall();
      // No errors means success
    });
  });

  describe("intercept", () => {
    it("should return undefined in recording mode", () => {
      const result = interceptor.intercept({ model: "gpt-4", prompt: "test" });
      expect(result).toBeUndefined();
    });
  });

  describe("recordCall", () => {
    it("should record call and response events", async () => {
      interceptor.install(mockRecorder);

      const config: LLMCallConfig = {
        model: "gpt-4",
        prompt: "Hello, world!",
      };

      const response = await interceptor.recordCall(config, async () => ({
        response: "Hi there!",
        latencyMs: 100,
      }));

      expect(response.response).toBe("Hi there!");
      expect(mockRecorder.appendEvent).toHaveBeenCalledTimes(2);

      // Check call event
      expect(mockRecorder.events[0].type).toBe("llm_call");

      // Check response event
      expect(mockRecorder.events[1].type).toBe("llm_response");
    });

    it("should work without recorder installed", async () => {
      // Don't install recorder
      const config: LLMCallConfig = {
        model: "gpt-4",
        prompt: "Hello",
      };

      const response = await interceptor.recordCall(config, async () => ({
        response: "World",
        latencyMs: 50,
      }));

      expect(response.response).toBe("World");
    });

    it("should include optional parameters", async () => {
      interceptor.install(mockRecorder);

      const config: LLMCallConfig = {
        model: "gpt-4",
        prompt: "Test",
        systemPrompt: "You are helpful",
        temperature: 0.7,
        maxTokens: 100,
      };

      await interceptor.recordCall(config, async () => ({
        response: "Response",
        tokensUsed: 50,
        finishReason: "stop",
        latencyMs: 100,
      }));

      const callPayload = mockRecorder.events[0].payload as Record<
        string,
        unknown
      >;
      expect(callPayload.model).toBe("gpt-4");
      expect(callPayload.temperature).toBe(0.7);
      expect(callPayload.maxTokens).toBe(100);
    });

    it("should exclude prompts by default", async () => {
      interceptor.install(mockRecorder);

      await interceptor.recordCall(
        { model: "gpt-4", prompt: "Secret prompt" },
        async () => ({ response: "Secret response", latencyMs: 50 }),
      );

      const callPayload = mockRecorder.events[0].payload as Record<
        string,
        unknown
      >;
      expect(callPayload.prompt).toBeUndefined();
      expect(callPayload.promptHash).toBeDefined();
    });

    it("should include prompts when configured", async () => {
      const includePromptsInterceptor = new RecordingLLMInterceptor({
        includePrompts: true,
      });
      includePromptsInterceptor.install(mockRecorder);

      await includePromptsInterceptor.recordCall(
        { model: "gpt-4", prompt: "Include me" },
        async () => ({ response: "Included", latencyMs: 50 }),
      );

      const callPayload = mockRecorder.events[0].payload as Record<
        string,
        unknown
      >;
      expect(callPayload.prompt).toBe("Include me");
    });

    it("should apply redaction patterns", async () => {
      const redactingInterceptor = new RecordingLLMInterceptor({
        includePrompts: true,
        redactPatterns: [/secret-\d+/g],
      });
      redactingInterceptor.install(mockRecorder);

      await redactingInterceptor.recordCall(
        { model: "gpt-4", prompt: "My secret-12345 is hidden" },
        async () => ({ response: "Response with secret-67890", latencyMs: 50 }),
      );

      const callPayload = mockRecorder.events[0].payload as Record<
        string,
        unknown
      >;
      expect(callPayload.prompt).toBe("My [REDACTED] is hidden");
    });
  });

  describe("getCalls", () => {
    it("should return recorded calls", async () => {
      interceptor.install(mockRecorder);

      await interceptor.recordCall(
        { model: "gpt-4", prompt: "Hello" },
        async () => ({ response: "World", latencyMs: 50 }),
      );

      const calls = interceptor.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].config.prompt).toBe("Hello");
      expect(calls[0].response.response).toBe("World");
    });

    it("should return copy of calls array", async () => {
      interceptor.install(mockRecorder);

      await interceptor.recordCall(
        { model: "gpt-4", prompt: "Test" },
        async () => ({ response: "Result", latencyMs: 50 }),
      );

      const calls1 = interceptor.getCalls();
      const calls2 = interceptor.getCalls();
      expect(calls1).not.toBe(calls2);
    });
  });
});

describe("ReplayLLMInterceptor", () => {
  const recordedCalls: RecordedLLMCall[] = [
    {
      config: { model: "gpt-4", prompt: "Hello" },
      configHash: "hash1",
      response: { response: "Hi there!", latencyMs: 100 },
      responseHash: "hash2",
    },
    {
      config: { model: "gpt-4", prompt: "How are you?" },
      configHash: "hash3",
      response: { response: "I am fine!", latencyMs: 50 },
      responseHash: "hash4",
    },
  ];

  let interceptor: ReplayLLMInterceptor;

  beforeEach(() => {
    interceptor = new ReplayLLMInterceptor([...recordedCalls]);
  });

  describe("name", () => {
    it("should have name 'llm'", () => {
      expect(interceptor.name).toBe("llm");
    });
  });

  describe("install / uninstall", () => {
    it("should install and reset index", () => {
      const mockRecorder = createMockRecorder();
      interceptor.install(mockRecorder);
      expect(interceptor.getRemainingCalls()).toBe(2);
    });

    it("should uninstall cleanly", () => {
      const mockRecorder = createMockRecorder();
      interceptor.install(mockRecorder);
      interceptor.uninstall();
    });
  });

  describe("intercept", () => {
    it("should return response for LLM call config", async () => {
      const result = interceptor.intercept({ model: "gpt-4", prompt: "Hello" });
      expect(result).toBeInstanceOf(Promise);

      const response = await result;
      expect((response as LLMCallResponse).response).toBe("Hi there!");
    });

    it("should return undefined for non-LLM requests", () => {
      const result = interceptor.intercept({
        type: "database",
        query: "SELECT",
      });
      expect(result).toBeUndefined();
    });

    it("should return undefined for invalid objects", () => {
      expect(interceptor.intercept(null)).toBeUndefined();
      expect(interceptor.intercept(undefined)).toBeUndefined();
      expect(interceptor.intercept("string")).toBeUndefined();
      expect(interceptor.intercept(123)).toBeUndefined();
    });
  });

  describe("replayCall", () => {
    it("should return cached response", async () => {
      const response = await interceptor.replayCall({
        model: "gpt-4",
        prompt: "Hello",
      });

      expect(response.response).toBe("Hi there!");
      expect(response.latencyMs).toBe(100);
    });

    it("should advance through recorded calls", async () => {
      await interceptor.replayCall({ model: "gpt-4", prompt: "Hello" });
      const response = await interceptor.replayCall({
        model: "gpt-4",
        prompt: "How are you?",
      });

      expect(response.response).toBe("I am fine!");
    });

    it("should throw when calls exhausted", async () => {
      await interceptor.replayCall({ model: "gpt-4", prompt: "1" });
      await interceptor.replayCall({ model: "gpt-4", prompt: "2" });

      await expect(
        interceptor.replayCall({ model: "gpt-4", prompt: "3" }),
      ).rejects.toThrow("Replay exhausted");
    });

    it("should warn on config hash mismatch", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await interceptor.replayCall({
        model: "gpt-4",
        prompt: "Different prompt than recorded",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("config mismatch"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getRemainingCalls", () => {
    it("should return correct count", () => {
      expect(interceptor.getRemainingCalls()).toBe(2);
    });

    it("should decrement after replay", async () => {
      await interceptor.replayCall({ model: "gpt-4", prompt: "test" });
      expect(interceptor.getRemainingCalls()).toBe(1);
    });
  });

  describe("reset", () => {
    it("should reset replay index", async () => {
      await interceptor.replayCall({ model: "gpt-4", prompt: "test" });
      await interceptor.replayCall({ model: "gpt-4", prompt: "test" });
      expect(interceptor.getRemainingCalls()).toBe(0);

      interceptor.reset();
      expect(interceptor.getRemainingCalls()).toBe(2);
    });
  });
});
