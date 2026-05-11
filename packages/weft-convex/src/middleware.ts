import type { Trace } from "@weft/core";
import { ai } from "@weft/core/server";
import type { FunctionReference, GenericActionCtx } from "convex/server";

export interface MiddlewareStack {
  wrap<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ActivityContext {
  projectId?: string;
  threadId?: string;
}

export interface CostContext {
  userId?: string;
  projectId?: string;
}

/**
 * Capture the trace produced during `fn()` without relying on the global
 * `ai.lastTrace()` singleton, which races under concurrent Convex actions.
 *
 * ⚠️ FIX-GUARD[FP-MIDDLEWARE-LASTTRACE-RACE-20260313]: Replaced global
 * ai.lastTrace() reads with per-invocation onTrace callback to prevent
 * cross-action trace misattribution in concurrent Node.js processes.
 */
async function withTraceCaptured<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; trace: Trace | null }> {
  let captured: Trace | null = null;
  const unsubscribe = ai.onTrace((t: Trace) => {
    captured = t;
  });
  try {
    const result = await fn();
    return { result, trace: captured };
  } finally {
    unsubscribe();
  }
}

/**
 * Activity logging middleware.
 * Records prompt, response, model, duration via the provided mutation ref.
 *
 * ⚠️ FIX-GUARD[FP-LOGACTIVITY-SCOPE-20260303]: Callers must pass activityContext with
 * projectId and threadId to prevent cross-user activity misattribution.
 */
export function createActivityMiddleware(
  ctx: GenericActionCtx<any>,
  logActivityMutation: FunctionReference<"mutation", "public" | "internal">,
  activityContext?: ActivityContext,
) {
  return async <T>(next: () => Promise<T>): Promise<T> => {
    const startTime = Date.now();
    const { result, trace } = await withTraceCaptured(next);
    const duration = Date.now() - startTime;

    if (trace) {
      await ctx
        .runMutation(logActivityMutation, {
          prompt: trace.prompt,
          response:
            typeof result === "string" ? result : JSON.stringify(result),
          model: trace.model,
          duration,
          projectId: activityContext?.projectId,
          threadId: activityContext?.threadId,
        })
        .catch((err: unknown) =>
          console.error("[Weft] Activity logging failed:", err),
        );
    }
    return result;
  };
}

/**
 * Cost tracking middleware.
 * Extracts token usage from trace and persists via the provided mutation ref.
 *
 * ⚠️ FIX-GUARD[FP-TRACKCOST-SCOPE-20260303]: Callers must pass costContext with
 * userId to prevent cross-user cost misattribution.
 */
export function createCostMiddleware(
  ctx: GenericActionCtx<any>,
  trackCostMutation: FunctionReference<"mutation", "public" | "internal">,
  costContext?: CostContext,
) {
  return async <T>(next: () => Promise<T>): Promise<T> => {
    const { result, trace } = await withTraceCaptured(next);

    if (trace) {
      await ctx
        .runMutation(trackCostMutation, {
          model: trace.model,
          inputTokens: trace.tokens.input,
          outputTokens: trace.tokens.output,
          totalTokens: trace.tokens.total,
          userId: costContext?.userId,
          projectId: costContext?.projectId,
        })
        .catch((err: unknown) =>
          console.error("[Weft] Cost tracking failed:", err),
        );
    }
    return result;
  };
}

/**
 * Middleware stack implementation
 */
export class MiddlewareStackImpl implements MiddlewareStack {
  private middlewares: Array<(next: () => Promise<any>) => Promise<any>> = [];

  use(middleware: (next: () => Promise<any>) => Promise<any>) {
    this.middlewares.push(middleware);
    return this;
  }

  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    let current = fn;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i];
      const next = current;
      current = () => middleware(next);
    }
    return current();
  }
}
