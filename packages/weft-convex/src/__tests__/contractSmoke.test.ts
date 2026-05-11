/**
 * Package Contract Smoke Test — weft-convex
 *
 * Proves that the package entrypoint exports what the contract claims,
 * and that the API surface matches the documented supported path.
 */

import { describe, expect, it } from "vitest";
import {
  createActivityMiddleware,
  createCostMiddleware,
  MiddlewareStackImpl,
} from "../middleware";
import { streamToMutation } from "../streaming";
import type { ConvexAIOptions } from "../withAI";
import { withAI } from "../withAI";

const stubCtx = { runMutation: async () => {} } as any;

describe("weft-convex — Package Contract Smoke", () => {
  describe("Entrypoint version export", () => {
    it("exports version string from entrypoint", async () => {
      const entrypoint = await import("../index");
      expect(typeof entrypoint.version).toBe("string");
      expect(entrypoint.version).toBe("0.1.0");
    });
  });

  describe("Middleware exports", () => {
    it("exports MiddlewareStackImpl class", () => {
      expect(MiddlewareStackImpl).toBeDefined();
      const stack = new MiddlewareStackImpl();
      expect(typeof stack.use).toBe("function");
      expect(typeof stack.wrap).toBe("function");
    });

    it("exports createActivityMiddleware function", () => {
      expect(typeof createActivityMiddleware).toBe("function");
    });

    it("exports createCostMiddleware function", () => {
      expect(typeof createCostMiddleware).toBe("function");
    });
  });

  describe("Streaming exports", () => {
    it("exports streamToMutation function", () => {
      expect(typeof streamToMutation).toBe("function");
    });
  });

  describe("withAI exports", () => {
    it("exports withAI function", () => {
      expect(typeof withAI).toBe("function");
    });
  });

  describe("MiddlewareStackImpl behavior", () => {
    it("wraps functions with middleware in correct order", async () => {
      const order: string[] = [];
      const stack = new MiddlewareStackImpl();

      stack.use(async (next) => {
        order.push("a-before");
        const r = await next();
        order.push("a-after");
        return r;
      });
      stack.use(async (next) => {
        order.push("b-before");
        const r = await next();
        order.push("b-after");
        return r;
      });

      const result = await stack.wrap(async () => {
        order.push("handler");
        return 42;
      });

      expect(result).toBe(42);
      expect(order).toEqual([
        "a-before",
        "b-before",
        "handler",
        "b-after",
        "a-after",
      ]);
    });
  });

  describe("API surface contract", () => {
    it("main path exposes generate, streamToMutation, raw — NOT a top-level generateTyped", () => {
      const api = withAI(stubCtx);

      expect(typeof api.generate).toBe("function");
      expect(typeof api.streamToMutation).toBe("function");
      expect(typeof api.raw).toBe("function");

      expect("generateTyped" in api).toBe(false);
    });

    it("experimental.generateTyped is available under the experimental namespace", () => {
      const api = withAI(stubCtx);

      expect(typeof api.experimental).toBe("object");
      expect(typeof api.experimental.generateTyped).toBe("function");
    });

    it("ConvexAIOptions accepts typed mutations, not internalApi", () => {
      const opts: ConvexAIOptions = {
        mutations: {
          logActivity: undefined,
          trackCost: undefined,
        },
      };
      const api = withAI(stubCtx, opts);
      expect(typeof api.generate).toBe("function");

      expect("internalApi" in opts).toBe(false);
    });

    it("withAI works with zero options (pure generate path)", async () => {
      const api = withAI(stubCtx);
      expect(typeof api.generate).toBe("function");
      expect(typeof api.experimental.generateTyped).toBe("function");
    });
  });
});
