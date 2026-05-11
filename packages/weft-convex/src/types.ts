import type { FunctionReference, GenericActionCtx } from "convex/server";

/**
 * Typed mutation references for Convex AI middleware.
 * Replaces the vague `internalApi: any` with explicit per-mutation refs.
 */
export interface MutationRefs {
  /** Mutation for activity logging. Receives { prompt, response, model, duration, projectId?, threadId? } */
  logActivity?: FunctionReference<"mutation", "public" | "internal">;
  /** Mutation for cost tracking. Receives { model, inputTokens, outputTokens, totalTokens, userId?, projectId? } */
  trackCost?: FunctionReference<"mutation", "public" | "internal">;
}

/**
 * Experimental helpers — not part of the supported weft-convex contract.
 */
export interface ConvexAIExperimental {
  /**
   * Generate structured output using a schema object (typically Zod).
   * Requires the `zod` peer dependency.
   * NOT part of the supported API — stability not guaranteed.
   */
  generateTyped: (prompt: string, schema: unknown) => Promise<unknown>;
}

/**
 * Context for Weft agents running within Convex actions
 */
export interface WeftConvexContext {
  convex: GenericActionCtx<any>;
}
