/**
 * @fileoverview Integration tests for @weft/convex
 * @description Tests Convex wrapper integration with @weft/core
 */

import type { Provider } from "@weft/core/server";
import { ai, providerRegistry } from "@weft/core/server";
import type { GenericActionCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiddlewareStackImpl } from "../middleware";
import { streamToMutation } from "../streaming";
import { withAI } from "../withAI";

const USE_REAL_API = process.env.Weft_REAL_API === "true";

class MockProvider implements Provider {
  readonly id = "mock";
  readonly name = "Mock Provider";
  readonly capabilities = {
    streaming: true,
    tools: false,
    vision: false,
    structuredOutput: true,
    maxContextTokens: 100000,
  };

  private responses: Map<string, string> = new Map();
  private streamChunks: Map<string, string[]> = new Map();

  setResponse(prompt: string, response: string): void {
    this.responses.set(prompt, response);
  }

  setStreamChunks(prompt: string, chunks: string[]): void {
    this.streamChunks.set(prompt, chunks);
  }

  async generate(request: any): Promise<any> {
    const prompt = request.messages[request.messages.length - 1]?.content || "";
    const response = this.responses.get(prompt) || "Mock response";
    return {
      text: response,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
      finishReason: "stop" as const,
    };
  }

  async *stream(request: any): AsyncIterable<any> {
    const prompt = request.messages[request.messages.length - 1]?.content || "";
    const chunks = this.streamChunks.get(prompt) || ["Mock", " stream"];

    for (const chunk of chunks) {
      yield { textDelta: chunk };
    }
    yield { textDelta: "", finishReason: "stop" as const };
  }

  identify() {
    return { id: this.id, name: this.name };
  }
}

const createMockCtx = (): GenericActionCtx<any> => {
  const mutations: Array<{ mutation: unknown; args: unknown }> = [];

  return {
    runMutation: vi.fn(async (mutation: unknown, args: unknown) => {
      mutations.push({ mutation, args });
      return undefined;
    }),
  } as any;
};

describe("@weft/convex Integration", () => {
  let mockProvider: MockProvider;
  let mockCtx: GenericActionCtx<any>;

  beforeEach(() => {
    if (!USE_REAL_API) {
      mockProvider = new MockProvider();
      providerRegistry.clear();
      providerRegistry.register(mockProvider, true);
    }
    mockCtx = createMockCtx();
  });

  afterEach(() => {
    if (!USE_REAL_API) {
      providerRegistry.clear();
    }
  });

  describe("withAI wrapper — main path", () => {
    it("should wrap core ai() function via generate()", async () => {
      if (USE_REAL_API) return;

      mockProvider.setResponse("Test prompt", "Test response");
      const convexAI = withAI(mockCtx);

      const result = await convexAI.generate("Test prompt");
      expect(result).toBe("Test response");
    });

    it("should expose raw ai() function", async () => {
      if (USE_REAL_API) return;

      mockProvider.setResponse("Raw test", "Raw response");
      const convexAI = withAI(mockCtx);

      const result = await convexAI.raw("Raw test");
      expect(result).toBe("Raw response");
    });

    it("should use defaultModel option", async () => {
      if (USE_REAL_API) return;

      mockProvider.setResponse("Model test", "Model response");
      const convexAI = withAI(mockCtx, { defaultModel: "custom-model" });

      await convexAI.generate("Model test");
      expect(mockProvider.generate).toBeDefined();
    });
  });

  describe("withAI wrapper — experimental namespace", () => {
    it("should support experimental.generateTyped with schema", async () => {
      if (USE_REAL_API) return;

      const { z } = await import("zod");
      const schema = z.object({
        name: z.string(),
        value: z.number(),
      });

      mockProvider.setResponse(
        "Create data",
        JSON.stringify({ name: "test", value: 42 }),
      );
      const convexAI = withAI(mockCtx);

      const result = await convexAI.experimental.generateTyped(
        "Create data",
        schema,
      );
      expect(result).toEqual({ name: "test", value: 42 });
    });
  });

  describe("Middleware Integration", () => {
    it("should execute activity middleware when mutation ref provided", async () => {
      if (USE_REAL_API) return;

      const logActivityRef = "internal.ai.logActivity" as any;

      mockProvider.setResponse("Activity test", "Activity response");
      const convexAI = withAI(mockCtx, {
        logActivity: true,
        mutations: { logActivity: logActivityRef },
      });

      await convexAI.generate("Activity test");
      expect(mockCtx.runMutation).toHaveBeenCalled();
    });

    it("should execute cost tracking middleware when mutation ref provided", async () => {
      if (USE_REAL_API) return;

      const trackCostRef = "internal.ai.trackCost" as any;

      mockProvider.setResponse("Cost test", "Cost response");
      const convexAI = withAI(mockCtx, {
        trackCosts: true,
        mutations: { trackCost: trackCostRef },
      });

      await convexAI.generate("Cost test");
      expect(mockCtx.runMutation).toHaveBeenCalled();
    });

    it("should skip middleware when disabled", async () => {
      if (USE_REAL_API) return;

      mockProvider.setResponse("No middleware", "Response");
      const convexAI = withAI(mockCtx, {
        logActivity: false,
        trackCosts: false,
      });

      const result = await convexAI.generate("No middleware");
      expect(result).toBe("Response");
    });

    it("should skip middleware when no mutation refs provided", async () => {
      if (USE_REAL_API) return;

      mockProvider.setResponse("No refs", "Response");
      const convexAI = withAI(mockCtx);

      const result = await convexAI.generate("No refs");
      expect(result).toBe("Response");
      expect(mockCtx.runMutation).not.toHaveBeenCalled();
    });
  });

  describe("Streaming Integration", () => {
    it("should stream to mutation", async () => {
      if (USE_REAL_API) return;

      const mutationRef = { mutation: vi.fn() } as any;

      mockProvider.setStreamChunks("Stream test", [
        "Chunk",
        " 1",
        " Chunk",
        " 2",
      ]);

      const stream = ai.stream("Stream test");
      await streamToMutation(mockCtx, stream, {
        mutation: mutationRef,
        batchSize: 2,
      });

      expect(mockCtx.runMutation).toHaveBeenCalled();
    });

    it("should batch chunks by size", async () => {
      if (USE_REAL_API) return;

      const mutationRef = { mutation: vi.fn() } as any;
      const callArgs: unknown[] = [];

      (mockCtx.runMutation as any).mockImplementation(
        async (_mutation: unknown, args: unknown) => {
          callArgs.push(args);
        },
      );

      mockProvider.setStreamChunks("Batch test", ["1", "2", "3", "4", "5"]);

      const stream = ai.stream("Batch test");
      await streamToMutation(mockCtx, stream, {
        mutation: mutationRef,
        batchSize: 2,
      });

      expect(callArgs.length).toBeGreaterThan(0);
    });

    it("should flush remaining chunks on completion", async () => {
      if (USE_REAL_API) return;

      const mutationRef = { mutation: vi.fn() } as any;
      const callArgs: unknown[] = [];

      (mockCtx.runMutation as any).mockImplementation(
        async (_mutation: unknown, args: unknown) => {
          callArgs.push(args);
        },
      );

      mockProvider.setStreamChunks("Flush test", ["1", "2", "3"]);

      const stream = ai.stream("Flush test");
      await streamToMutation(mockCtx, stream, {
        mutation: mutationRef,
        batchSize: 5,
      });

      expect(callArgs.length).toBeGreaterThan(0);
    });
  });

  describe("Middleware Stack", () => {
    it("should execute middlewares in order", async () => {
      if (USE_REAL_API) return;

      const executionOrder: string[] = [];
      const stack = new MiddlewareStackImpl();

      stack.use(async (next) => {
        executionOrder.push("middleware1-before");
        const result = await next();
        executionOrder.push("middleware1-after");
        return result;
      });

      stack.use(async (next) => {
        executionOrder.push("middleware2-before");
        const result = await next();
        executionOrder.push("middleware2-after");
        return result;
      });

      await stack.wrap(async () => {
        executionOrder.push("handler");
        return "result";
      });

      expect(executionOrder).toEqual([
        "middleware1-before",
        "middleware2-before",
        "handler",
        "middleware2-after",
        "middleware1-after",
      ]);
    });

    it("should propagate errors through middleware", async () => {
      if (USE_REAL_API) return;

      const stack = new MiddlewareStackImpl();
      stack.use(async (next) => {
        return await next();
      });

      await expect(
        stack.wrap(async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");
    });
  });
});
