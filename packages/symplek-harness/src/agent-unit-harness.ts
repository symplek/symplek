/**
 * @module SymplekHarness/AgentUnitHarness
 * @description Wraps an AgentUnit with interceptor injection for replay-based testing.
 *   withInterceptor() passes the interceptor through context.extensions so
 *   instrumented agents can switch from recording to replay without modifying their logic.
 */

import { AgentUnit } from "@symplek/core";
import type { AgentContext } from "@symplek/core";
import type { InterceptorProvider } from "@symplek/core/rehearsal";

// The context extensions key used to surface the active interceptor.
// Instrumented agent computations check ctx.extensions?.__symplek_interceptor.
export const INTERCEPTOR_EXTENSION_KEY = "__symplek_interceptor" as const;

/**
 * Harness wrapper that adds interceptor injection to any AgentUnit.
 *
 * Typical use: replace recording-mode interceptors with replay-mode interceptors
 * in CI tests so no real LLM API calls are made.
 *
 * @example
 * ```typescript
 * import { AgentUnitHarness } from "@symplek/harness";
 * import { ReplayLLMInterceptor, extractLLMCallsFromTrace } from "@symplek/core/rehearsal";
 *
 * const calls = extractLLMCallsFromTrace(goldenTrace);
 * const harness = new AgentUnitHarness(myUnit);
 * const replayUnit = harness.withInterceptor(new ReplayLLMInterceptor(calls));
 * const result = await replayUnit.run(ctx);
 * ```
 */
export class AgentUnitHarness<T> {
  constructor(private readonly unit: AgentUnit<T>) {}

  /**
   * Return an AgentUnit that surfaces the given interceptor via
   * `ctx.extensions.__symplek_interceptor`. The inner unit's computation can
   * retrieve it and use `interceptor.replayCall()` (or `intercept()`) instead
   * of calling the real provider.
   *
   * @param interceptor - An InterceptorProvider (e.g. ReplayLLMInterceptor)
   * @returns A new AgentUnit with the interceptor active in its context
   */
  withInterceptor(interceptor: InterceptorProvider): AgentUnit<T> {
    const innerUnit = this.unit;
    return AgentUnit.from<T>(async (ctx: AgentContext) => {
      const replayCtx: AgentContext = {
        ...ctx,
        extensions: {
          ...ctx.extensions,
          [INTERCEPTOR_EXTENSION_KEY]: interceptor,
        },
      };
      // Access the inner computation directly to avoid double TrackedResult wrapping.
      const computation = (
        innerUnit as unknown as {
          computation: (ctx: AgentContext) => Promise<T>;
        }
      ).computation;
      return computation(replayCtx);
    });
  }
}
