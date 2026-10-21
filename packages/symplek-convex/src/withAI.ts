import type { GenericActionCtx } from "convex/server";
import { ai } from "@symplek/core/server";
import type { z } from "zod";
import {
  createActivityMiddleware,
  createCostMiddleware,
  MiddlewareStackImpl,
} from "./middleware";
import { type StreamToMutationConfig, streamToMutation } from "./streaming";
import type { ConvexAIExperimental, MutationRefs } from "./types";

/**
 * Options for the Convex AI wrapper.
 * Pass explicit mutation references via `mutations` — the old `internalApi: any` is gone.
 */
export interface ConvexAIOptions {
  /** Whether to log AI activity (default: true when logActivity mutation provided) */
  logActivity?: boolean;
  /** Whether to track token costs (default: true when trackCost mutation provided) */
  trackCosts?: boolean;
  /** Default model to use for generations */
  defaultModel?: string;
  /** Explicit Convex mutation references for middleware (replaces internalApi) */
  mutations?: MutationRefs;
  /**
   * Activity scope required by logActivity to prevent cross-user misattribution.
   * ⚠️ FIX-GUARD[FP-LOGACTIVITY-SCOPE-20260303]: Must be passed by callers with their own projectId/threadId.
   */
  activityContext?: { projectId?: string; threadId?: string };
  /**
   * Cost scope required by trackCost to prevent cross-user misattribution.
   * ⚠️ FIX-GUARD[FP-TRACKCOST-SCOPE-20260303]: Must be passed by callers with their own userId/projectId.
   */
  costContext?: { userId?: string; projectId?: string };
}

/**
 * Supported Convex AI interface returned by withAI.
 *
 * Main path: `generate`, `streamToMutation`, `raw`.
 * Experimental (unsupported for internal trust): `experimental.generateTyped`.
 */
export interface ConvexAI {
  /** Generate text using a simple prompt */
  generate: (prompt: string) => Promise<string>;
  /** Stream AI output directly to a Convex mutation */
  streamToMutation: (
    stream: AsyncIterable<string>,
    config: StreamToMutationConfig,
  ) => Promise<void>;
  /** The raw ai() function from @symplek/core */
  raw: typeof ai;
  /** Experimental helpers — not part of the supported API contract */
  experimental: ConvexAIExperimental;
}

/**
 * withAI(ctx) wrapper for Convex actions.
 *
 * Supported path: `generate`, `streamToMutation`, `raw`.
 * Experimental: `experimental.generateTyped` (requires Zod peer dependency).
 *
 * @param ctx The Convex ActionCtx
 * @param options Configuration options
 * @returns ConvexAI interface
 *
 * @throws When `mutations.logActivity` is provided without `activityContext`.
 *   Pass `activityContext: { projectId, threadId }` to prevent cross-user
 *   activity misattribution. See FIX-GUARD[FP-LOGACTIVITY-SCOPE-20260303].
 *
 * @throws When `mutations.trackCost` is provided without `costContext.userId`.
 *   Pass `costContext: { userId }` to prevent cross-user cost misattribution.
 *   See FIX-GUARD[FP-TRACKCOST-SCOPE-20260303].
 */
export function withAI(
  ctx: GenericActionCtx<any>,
  options?: ConvexAIOptions,
): ConvexAI {
  // ── Scope context enforcement ──────────────────────────────────────────────
  // Middleware that writes per-user data MUST have a scope context to prevent
  // cross-user record misattribution. Fail loudly at construction time, not
  // silently at record time when the mutation fires with undefined owner fields.
  //
  // Note: these guards fire only when a real FunctionReference is provided.
  // Passing `logActivity: undefined` or omitting `mutations` entirely is fine.
  if (options?.mutations?.logActivity && !options.activityContext) {
    throw new Error(
      "[withAI] activityContext is required when mutations.logActivity is provided. " +
        "Pass { projectId, threadId } to prevent cross-user activity misattribution. " +
        "FIX-GUARD[FP-LOGACTIVITY-SCOPE-20260303]",
    );
  }
  if (options?.mutations?.trackCost && !options.costContext?.userId) {
    throw new Error(
      "[withAI] costContext.userId is required when mutations.trackCost is provided. " +
        "Pass { userId } to prevent cross-user cost misattribution. " +
        "FIX-GUARD[FP-TRACKCOST-SCOPE-20260303]",
    );
  }

  const stack = new MiddlewareStackImpl();

  if (options?.logActivity !== false && options?.mutations?.logActivity) {
    stack.use(
      createActivityMiddleware(
        ctx,
        options.mutations.logActivity,
        options.activityContext,
      ),
    );
  }

  if (options?.trackCosts !== false && options?.mutations?.trackCost) {
    stack.use(
      createCostMiddleware(
        ctx,
        options.mutations.trackCost,
        options.costContext,
      ),
    );
  }

  return {
    generate: async (prompt: string) => {
      return stack.wrap(() =>
        ai(prompt, {
          model: options?.defaultModel,
        }),
      );
    },
    streamToMutation: async (
      stream: AsyncIterable<string>,
      config: StreamToMutationConfig,
    ) => {
      return streamToMutation(ctx, stream, config);
    },
    raw: ai,
    experimental: {
      generateTyped: async (prompt: string, schema: unknown) => {
        return stack.wrap(() =>
          ai(prompt, {
            schema: schema as z.ZodType<unknown>,
            model: options?.defaultModel,
          }),
        );
      },
    },
  };
}
