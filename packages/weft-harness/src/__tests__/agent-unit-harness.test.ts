/**
 * @module AgentUnitHarnessTests
 * @description Tests for AgentUnitHarness.withInterceptor() — interceptor injection
 *   for replay-based CI testing. Verifies that the interceptor is surfaced via
 *   ctx.extensions and that real providers are never called.
 */

import { AgentUnit, createContext } from "weft-core";
import type { AgentContext } from "weft-core";
import {
  ReplayLLMInterceptor,
  TRACE_SCHEMA_VERSION,
  toGoldenTrace,
} from "weft-core/rehearsal";
import { describe, expect, it } from "vitest";
import { AgentUnitHarness, INTERCEPTOR_EXTENSION_KEY } from "../agent-unit-harness";
import type { InterceptorProvider } from "weft-core/rehearsal";

// ─── Minimal trace builder ─────────────────────────────────────────────────────

/** Build the minimal ExecutionTrace shape required by toGoldenTrace. */
function makeTinyTrace(finalOutput: string) {
  return {
    id: "t1",
    version: TRACE_SCHEMA_VERSION,
    startTime: 100,
    endTime: 200,
    events: [] as never[],
    checkpoints: [] as never[],
    finalOutput,
    metadata: {
      composition: "test",
      agentCount: 1,
      eventCount: 0,
      durationMs: 100,
      schemaVersion: TRACE_SCHEMA_VERSION,
      operatorChain: [],
      includesPrompts: false,
      checkpointCount: 0,
    },
  } as const;
}

// ─── Stub interceptor ─────────────────────────────────────────────────────────

class StubInterceptor implements InterceptorProvider {
  readonly name = "stub";
  installed = false;
  install(): void {
    this.installed = true;
  }
  uninstall(): void {
    this.installed = false;
  }
  intercept(_request: unknown): Promise<unknown> | undefined {
    return undefined;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AgentUnitHarness", () => {
  it("withInterceptor surfaces the interceptor in ctx.extensions", async () => {
    let capturedInterceptor: unknown;

    const unit = AgentUnit.from(async (ctx: AgentContext) => {
      capturedInterceptor = ctx.extensions?.[INTERCEPTOR_EXTENSION_KEY];
      return "value";
    });

    const stub = new StubInterceptor();
    const harness = new AgentUnitHarness(unit);
    const wrappedUnit = harness.withInterceptor(stub);

    const ctx = createContext();
    await wrappedUnit.run(ctx);

    expect(capturedInterceptor).toBe(stub);
  });

  it("withInterceptor does not call the real provider when ReplayLLMInterceptor is active", async () => {
    let providerCalled = false;

    // Instrumented unit: checks for replay interceptor; only calls provider if absent
    const instrumentedUnit = AgentUnit.from(async (ctx: AgentContext) => {
      const interceptor = ctx.extensions?.[INTERCEPTOR_EXTENSION_KEY] as
        | ReplayLLMInterceptor
        | undefined;

      if (interceptor) {
        const response = await interceptor.replayCall({
          model: "claude-3-5-sonnet",
          prompt: "What is 1+1?",
        });
        return response.response;
      }

      // No interceptor — call real provider (must not happen in this test)
      providerCalled = true;
      throw new Error("Real provider called — interceptor should have handled this");
    });

    // Build a golden trace (not used for replay here — just structurally present)
    const tinyTrace = makeTinyTrace("2");
    void toGoldenTrace(tinyTrace); // ensure toGoldenTrace is exercised

    // Build a ReplayLLMInterceptor that returns "2" for any call
    const calls = [
      {
        config: { model: "claude-3-5-sonnet", prompt: "What is 1+1?" },
        configHash: "any",
        response: { response: "2", latencyMs: 0 },
        responseHash: "r",
      },
    ];
    const replayInterceptor = new ReplayLLMInterceptor(calls);

    const harness = new AgentUnitHarness(instrumentedUnit);
    const replayUnit = harness.withInterceptor(replayInterceptor);

    const ctx = createContext();
    const result = await replayUnit.run(ctx);

    expect(providerCalled).toBe(false);
    expect(result.value).toBe("2");
  });

  it("withInterceptor preserves existing context extensions", async () => {
    let seenExtensions: Record<string, unknown> | undefined;

    const unit = AgentUnit.from(async (ctx: AgentContext) => {
      seenExtensions = ctx.extensions;
      return "ok";
    });

    const stub = new StubInterceptor();
    const harness = new AgentUnitHarness(unit);
    const wrappedUnit = harness.withInterceptor(stub);

    const ctx = createContext({ extensions: { myKey: "myValue" } });
    await wrappedUnit.run(ctx);

    expect(seenExtensions?.myKey).toBe("myValue");
    expect(seenExtensions?.[INTERCEPTOR_EXTENSION_KEY]).toBe(stub);
  });

  it("INTERCEPTOR_EXTENSION_KEY is the stable string '__weft_interceptor'", () => {
    expect(INTERCEPTOR_EXTENSION_KEY).toBe("__weft_interceptor");
  });
});
