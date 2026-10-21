import type { FunctionReference, GenericActionCtx } from "convex/server";
import type { Trace } from "@symplek/core";
import { ai } from "@symplek/core/server";

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
 * Capture the trace produced during `fn()` using AsyncLocalStorage-backed
 * per-invocation scoping. Two concurrent Convex actions running in the same
 * Node.js process will not see each other's traces.
 *
 * ⚠️ FIX-GUARD[FP-MIDDLEWARE-LASTTRACE-RACE-20260313]: First attempt used
 * `ai.lastTrace()`, then switched to broadcast `ai.onTrace()` — both raced
 * under concurrent withAI() calls because the trace manager is a process
 * global. Final fix: `ai.withScope(fn)` returns only the traces produced
 * inside `fn`'s async-local context. If multiple traces fire during one
 * middleware invocation, we report the latest (matches prior semantics for
 * single-trace operations, which is the common case).
 */
async function withTraceCaptured<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; trace: Trace | null }> {
  const { result, traces } = await ai.withScope(fn);
  const trace = traces.length > 0 ? (traces[traces.length - 1] ?? null) : null;
  return { result, trace };
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
          console.error("[Symplek] Activity logging failed:", err),
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
          console.error("[Symplek] Cost tracking failed:", err),
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
