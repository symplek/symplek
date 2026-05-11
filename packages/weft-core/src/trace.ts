/**
 * @fileoverview Tracing and debugging for AI calls.
 */

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

class TraceManager {
  private _debug = false;
  private _lastTrace: Trace | null = null;
  private _callbacks: TraceCallback[] = [];

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

  /** @internal */
  record(trace: Trace): void {
    this._lastTrace = trace;

    // Notify callbacks
    for (const callback of this._callbacks) {
      try {
        callback(trace);
      } catch (error) {
        console.error("[Weft] Error in onTrace callback:", error);
      }
    }

    // Log to console if debug is enabled
    if (this._debug) {
      this.logToConsole(trace);
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
