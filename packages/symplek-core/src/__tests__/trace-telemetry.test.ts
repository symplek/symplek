/**
 * @module trace-telemetry.test — Truth-in-telemetry tests (Move 10 / Item 4 / Item 5)
 * @description Tests that enforce the honest contracts for trace.ts:
 *   - Item 4: TraceRedactor actually controls prompt/response content.
 *   - Item 5: lastTrace()/onTrace() warn loudly when called inside a withScope() context.
 *
 *   A failure here means the contract regressed, not that the test is wrong.
 *
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceManager } from "../trace";
import type { Trace } from "../trace";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    id: "test-trace-id",
    duration: 100,
    provider: "test-provider",
    model: "test-model",
    prompt: "This is a long prompt that should be redactable",
    response: "This is a long response that should be redactable",
    tokens: { input: 10, output: 20, total: 30 },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─── Item 4: TraceRedactor controls stored content ────────────────────────────

describe("Item 4 — TraceRedactor hooks control stored prompt/response", () => {
  afterEach(() => {
    // Remove any installed redactor between tests.
    traceManager.setRedactor(null);
  });

  it("without a redactor, full prompt and response are stored verbatim", () => {
    const trace = makeTrace({ prompt: "full prompt text", response: "full response text" });
    traceManager.record(trace);
    expect(traceManager.lastTrace()?.prompt).toBe("full prompt text");
    expect(traceManager.lastTrace()?.response).toBe("full response text");
  });

  it("setRedactor truncates prompt and response before storage", () => {
    traceManager.setRedactor(({ prompt, response }) => ({
      prompt: prompt.slice(0, 5),
      response: response.slice(0, 4),
    }));

    const trace = makeTrace({
      prompt: "long prompt that exceeds truncation limit",
      response: "long response that exceeds truncation limit",
    });
    traceManager.record(trace);

    expect(traceManager.lastTrace()?.prompt).toBe("long ");
    expect(traceManager.lastTrace()?.response).toBe("long");
  });

  it("redactor runs before onTrace broadcast — subscriber receives redacted content", () => {
    traceManager.setRedactor(() => ({ prompt: "REDACTED", response: "REDACTED" }));

    const received: Trace[] = [];
    const unsubscribe = traceManager.onTrace((t) => received.push(t));

    traceManager.record(makeTrace({ prompt: "sensitive", response: "sensitive" }));
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0].prompt).toBe("REDACTED");
    expect(received[0].response).toBe("REDACTED");
  });

  it("redactor runs before scope capture — withScope receives redacted content", async () => {
    traceManager.setRedactor(() => ({ prompt: "SCOPED-REDACTED", response: "SCOPED-REDACTED" }));

    const { traces } = await traceManager.withScope(async () => {
      traceManager.record(makeTrace({ prompt: "original prompt", response: "original response" }));
      return "done";
    });

    expect(traces).toHaveLength(1);
    expect(traces[0].prompt).toBe("SCOPED-REDACTED");
    expect(traces[0].response).toBe("SCOPED-REDACTED");
  });

  it("setRedactor(null) removes the hook — full content stored again", () => {
    traceManager.setRedactor(() => ({ prompt: "X", response: "X" }));
    traceManager.setRedactor(null);

    const trace = makeTrace({ prompt: "full prompt", response: "full response" });
    traceManager.record(trace);

    expect(traceManager.lastTrace()?.prompt).toBe("full prompt");
    expect(traceManager.lastTrace()?.response).toBe("full response");
  });

  it("non-prompt/response fields are preserved through redaction", () => {
    traceManager.setRedactor(() => ({ prompt: "P", response: "R" }));

    const trace = makeTrace({ model: "my-model", provider: "my-provider", duration: 999 });
    traceManager.record(trace);

    const last = traceManager.lastTrace();
    expect(last?.model).toBe("my-model");
    expect(last?.provider).toBe("my-provider");
    expect(last?.duration).toBe(999);
    expect(last?.tokens.total).toBe(30);
  });
});

// ─── Item 5: Scope-active warnings on lastTrace() / onTrace() ────────────────

describe("Item 5 — lastTrace() and onTrace() warn when called inside a scope", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    traceManager.setRedactor(null);
  });

  it("lastTrace() emits a warning when called inside withScope()", async () => {
    await traceManager.withScope(async () => {
      traceManager.lastTrace();
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("lastTrace() called inside a withScope() context"),
    );
  });

  it("onTrace() emits a warning when registered inside withScope()", async () => {
    let unsubscribe: (() => void) | undefined;

    await traceManager.withScope(async () => {
      unsubscribe = traceManager.onTrace(() => {});
    });
    unsubscribe?.();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("onTrace() registered inside a withScope() context"),
    );
  });

  it("lastTrace() does NOT warn when called outside a scope", () => {
    traceManager.lastTrace();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("onTrace() does NOT warn when registered outside a scope", () => {
    const unsubscribe = traceManager.onTrace(() => {});
    unsubscribe();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
