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
 * Hosts that run Weft calls per-request (Convex actions, HTTP handlers,
 * queue workers) MUST use `withScope` instead of subscribing via `onTrace`.
 *
 * **Content retention**: `Trace.prompt` and `Trace.response` store the full
 * content by default. Install a `TraceRedactor` via `traceManager.setRedactor()`
 * (or `ai.setRedactor()`) to truncate or strip sensitive content before it is
 * stored, logged, or forwarded downstream.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface Trace {
  id: string;
  duration: number;
  provider: string;
  model: string;
  /** Full prompt text. Install a TraceRedactor to truncate or redact. */
  prompt: string;
  /** Full response text. Install a TraceRedactor to truncate or redact. */
  response: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  timestamp: number;
}

export type TraceCallback = (trace: Trace) => void;

/**
 * Hook applied to every trace before it is stored, broadcast, or forwarded.
 * Use this to truncate or strip prompt/response content.
 *
 * @example
 * ai.setRedactor(({ prompt, response }) => ({
 *   prompt: prompt.slice(0, 200),
 *   response: response.slice(0, 200),
 * }));
 */
export type TraceRedactor = (data: {
  prompt: string;
  response: string;
}) => { prompt: string; response: string };

interface TraceScope {
  traces: Trace[];
}

class TraceManager {
  private _debug = false;
  private _lastTrace: Trace | null = null;
  private _callbacks: TraceCallback[] = [];
  private _redactor: TraceRedactor | null = null;
  // AsyncLocalStorage backing for `withScope`. Each scope has its own
  // trace buffer; concurrent scopes are fully isolated.
  private readonly _scope = new AsyncLocalStorage<TraceScope>();

  get debug(): boolean {
    return this._debug;
  }

  set debug(value: boolean) {
    this._debug = value;
  }

  /**
   * Install a redaction hook. Applied to every trace in `record()` before the
   * trace is stored in `_lastTrace`, pushed to scope buffers, or broadcast to
   * subscribers. Pass `null` to remove a previously installed hook.
   *
   * The activity-middleware path in weft-convex persists `trace.prompt` and
   * `trace.response`; setting a redactor here controls what that path sees.
   */
  setRedactor(redactor: TraceRedactor | null): void {
    this._redactor = redactor;
  }

  /**
   * Returns the last recorded trace (process-global).
   *
   * ⚠️ Cross-tenant hazard: this value is shared across the whole Node process.
   * If called inside a `withScope()` context it will return another concurrent
   * request's trace — use the traces returned by `withScope()` instead.
   */
  lastTrace(): Trace | null {
    if (this._scope.getStore() !== undefined) {
      console.warn(
        "[Weft] lastTrace() called inside a withScope() context. " +
          "This returns a PROCESS-GLOBAL trace — under concurrency it may be " +
          "another request's trace. Use the traces array returned by withScope() " +
          "for per-request isolation.",
      );
    }
    return this._lastTrace;
  }

  /**
   * Register a callback fired for every recorded trace (process-global broadcast).
   *
   * ⚠️ Cross-tenant hazard: callbacks receive ALL traces in the process, not
   * just the current request's. If registered inside a `withScope()` context
   * the callback will cross-wire across concurrent requests. Use the traces
   * returned by `withScope()` for per-request isolation.
   */
  onTrace(callback: TraceCallback): () => void {
    if (this._scope.getStore() !== undefined) {
      console.warn(
        "[Weft] onTrace() registered inside a withScope() context. " +
          "Broadcast callbacks receive ALL traces in the process, not just the " +
          "current scope's. Use withScope() return value for per-request isolation.",
      );
    }
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
    // Apply redactor before storing so every downstream consumer (lastTrace,
    // scope buffers, broadcast callbacks, debug logging) sees the redacted form.
    const stored: Trace =
      this._redactor !== null
        ? {
            ...trace,
            ...this._redactor({ prompt: trace.prompt, response: trace.response }),
          }
        : trace;

    this._lastTrace = stored;

    // Per-invocation capture — isolated across concurrent withScope calls.
    const scope = this._scope.getStore();
    if (scope !== undefined) {
      scope.traces.push(stored);
    }

    // Broadcast subscribers (preserves existing onTrace contract).
    for (const callback of this._callbacks) {
      try {
        callback(stored);
      } catch (error) {
        console.error("[Weft] Error in onTrace callback:", error);
      }
    }

    if (this._debug) {
      this.logToConsole(stored);
    }
  }

  private logToConsole(trace: Trace): void {
    console.log(`[Weft] Starting request...`);
    console.log(`[Weft] Provider: ${trace.provider}`);
    console.log(`[Weft] Model: ${trace.model}`);
    console.log(
      `[Weft] Request: "${this.truncate(trace.prompt)}" (${trace.prompt.length} chars)`,
    );
    console.log(
      `[Weft] Response: "${this.truncate(trace.response)}" (${trace.response.length} chars)`,
    );
    console.log(
      `[Weft] Duration: ${trace.duration}ms | Tokens: ${trace.tokens.input} in / ${trace.tokens.output} out`,
    );
  }

  private truncate(text: string, maxLength = 50): string {
    if (text.length <= maxLength) return text;
    return `${text.substring(0, maxLength)}...`;
  }
}

export const traceManager = new TraceManager();
