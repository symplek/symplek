/**
 * @fileoverview Tracing and debugging for AI calls.
 *
 * Two delivery paths for traces, intentional and complementary:
 *
 *  1. **Broadcast subscribers** via `onTrace(cb)` — every recorded trace
 *     fires every subscribed callback. Good for global instrumentation
 *     (debug logging, dashboards). DANGEROUS for per-invocation capture
 *     under concurrency: with two concurrent `withAI()` calls in the same
 *     Node process, both subscribers see both traces and cross-wire.
 *
 *  2. **Async-local scope** via `withScope(fn)` — runs `fn` inside an
 *     AsyncLocalStorage context that collects only the traces produced
 *     during `fn`'s execution. Concurrent scopes are isolated, so a
 *     Convex action serving user A never captures user B's trace.
 *
 * Hosts that run Symplek calls per-request (Convex actions, HTTP handlers,
 * queue workers) MUST use `withScope` instead of subscribing via `onTrace`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface Trace {
  id: string;
  duration: number;
  provider: string;
  model: string;
  prompt: string; // truncated
  response: string; // truncated
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  timestamp: number;
}

export type TraceCallback = (trace: Trace) => void;

interface TraceScope {
  traces: Trace[];
}

class TraceManager {
  private _debug = false;
  private _lastTrace: Trace | null = null;
  private _callbacks: TraceCallback[] = [];
  // AsyncLocalStorage backing for `withScope`. Each scope has its own
  // trace buffer; concurrent scopes are fully isolated.
  private readonly _scope = new AsyncLocalStorage<TraceScope>();

  get debug(): boolean {
    return this._debug;
  }

  set debug(value: boolean) {
    this._debug = value;
  }

  lastTrace(): Trace | null {
    return this._lastTrace;
  }

  onTrace(callback: TraceCallback): () => void {
    this._callbacks.push(callback);
    return () => {
      const idx = this._callbacks.indexOf(callback);
      if (idx >= 0) this._callbacks.splice(idx, 1);
    };
  }

  /**
   * Run `fn` inside a trace scope and return its result together with every
   * trace recorded during its execution. Traces produced outside this scope
   * are not captured.
   *
   * @example
   *   const { result, traces } = await ai.withScope(() => userARequest());
   *   // `traces` contains only traces produced during userARequest(), even
   *   // if userBRequest() was running concurrently in the same process.
   */
  async withScope<T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; traces: Trace[] }> {
    const scope: TraceScope = { traces: [] };
    const result = await this._scope.run(scope, fn);
    return { result, traces: scope.traces };
  }

  /** @internal */
  record(trace: Trace): void {
    this._lastTrace = trace;

    // Per-invocation capture — isolated across concurrent withScope calls.
    const scope = this._scope.getStore();
    if (scope !== undefined) {
      scope.traces.push(trace);
    }

    // Broadcast subscribers (preserves existing onTrace contract).
    for (const callback of this._callbacks) {
      try {
        callback(trace);
      } catch (error) {
        console.error("[Symplek] Error in onTrace callback:", error);
      }
    }

    if (this._debug) {
      this.logToConsole(trace);
    }
  }

  private logToConsole(trace: Trace): void {
    console.log(`[Symplek] Starting request...`);
    console.log(`[Symplek] Provider: ${trace.provider}`);
    console.log(`[Symplek] Model: ${trace.model}`);
    console.log(
      `[Symplek] Request: "${this.truncate(trace.prompt)}" (${trace.prompt.length} chars)`,
    );
    console.log(
      `[Symplek] Response: "${this.truncate(trace.response)}" (${trace.response.length} chars)`,
    );
    console.log(
      `[Symplek] Duration: ${trace.duration}ms | Tokens: ${trace.tokens.input} in / ${trace.tokens.output} out`,
    );
  }

  private truncate(text: string, maxLength = 50): string {
    if (text.length <= maxLength) return text;
    return `${text.substring(0, maxLength)}...`;
  }
}

export const traceManager = new TraceManager();
