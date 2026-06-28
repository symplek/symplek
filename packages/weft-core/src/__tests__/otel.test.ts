/**
 * OpenTelemetry Export Contract Test — weft-core
 *
 * Verifies the additive OTLP export layer:
 *  - gen_ai semantic-convention attribute mapping (pure, dependency-free)
 *  - arbitrary / agent.cost.* / agent.error.* attribute passthrough
 *  - real span output captured through a mocked OTLP exporter: absolute
 *    timestamps, parent linkage, service resource, and custom attributes
 *  - the in-memory API is untouched (additive guarantee)
 *
 * Imports ONLY from "../index" (the package entrypoint). The OTLP HTTP
 * exporter is mocked so spans are captured in-process instead of sent over
 * the wire — the rest of the real OpenTelemetry SDK pipeline runs unmodified.
 */

import type { HrTime } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTraces,
  configureOpenTelemetry,
  createOperatorSpan,
  exportTraces,
  genAiSpanAttributes,
  getTraces,
  shutdownOpenTelemetry,
  trackError,
  type TraceEntry,
} from "../index";

const { exportedSpans } = vi.hoisted(() => ({
  exportedSpans: [] as ReadableSpan[],
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  class OTLPTraceExporter {
    export(
      spans: ReadableSpan[],
      resultCallback: (result: { code: number }) => void,
    ): void {
      exportedSpans.push(...spans);
      // ExportResultCode.SUCCESS === 0
      resultCallback({ code: 0 });
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
    forceFlush(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { OTLPTraceExporter };
});

/** Convert an OTel HrTime `[seconds, nanos]` tuple back to epoch milliseconds. */
function hrTimeToMs([seconds, nanos]: HrTime): number {
  return seconds * 1000 + nanos / 1e6;
}

describe("weft-core — OpenTelemetry export contract", () => {
  beforeEach(() => {
    clearTraces();
    exportedSpans.length = 0;
  });

  afterEach(async () => {
    await shutdownOpenTelemetry();
  });

  it("genAiSpanAttributes maps to gen_ai semantic conventions", () => {
    const entry: TraceEntry = {
      spanId: "s1",
      operatorType: "llm",
      operatorName: "generate",
      startedAt: 1000,
      endedAt: 1200,
      durationMs: 200,
      attributes: {
        system: "openai",
        model: "gpt-4o",
        responseModel: "gpt-4o-2024",
        inputTokens: 120,
        outputTokens: 45,
      },
    };

    const attrs = genAiSpanAttributes(entry);
    expect(attrs["gen_ai.system"]).toBe("openai");
    expect(attrs["gen_ai.request.model"]).toBe("gpt-4o");
    expect(attrs["gen_ai.response.model"]).toBe("gpt-4o-2024");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(120);
    expect(attrs["gen_ai.usage.output_tokens"]).toBe(45);
    expect(attrs["weft.operator.type"]).toBe("llm");
    expect(attrs["weft.operator.name"]).toBe("generate");
  });

  it("genAiSpanAttributes falls back to agent.cost.* keys", () => {
    const entry: TraceEntry = {
      spanId: "s2",
      operatorType: "llm",
      operatorName: "call",
      startedAt: 0,
      attributes: { "agent.cost.model": "claude-3" },
    };
    const attrs = genAiSpanAttributes(entry);
    expect(attrs["gen_ai.request.model"]).toBe("claude-3");
    expect(attrs["gen_ai.response.model"]).toBe("claude-3");
  });

  it("genAiSpanAttributes omits absent fields (no undefined values)", () => {
    const entry: TraceEntry = {
      spanId: "s3",
      operatorType: "unit",
      operatorName: "observable",
      startedAt: 0,
      attributes: {},
    };
    const attrs = genAiSpanAttributes(entry);
    expect(attrs).not.toHaveProperty("gen_ai.system");
    expect(attrs).not.toHaveProperty("gen_ai.request.model");
    for (const v of Object.values(attrs)) {
      expect(v).not.toBeUndefined();
    }
  });

  it("genAiSpanAttributes passes through custom, cost, and error attributes", () => {
    const entry: TraceEntry = {
      spanId: "s4",
      operatorType: "llm",
      operatorName: "generate",
      startedAt: 0,
      attributes: {
        "agent.cost.tokens": 321,
        "agent.error": true,
        "agent.error.message": "boom",
        customFlag: "on",
        // Raw gen_ai.* keys are derived canonically and must NOT be duplicated.
        "gen_ai.system": "openai",
      },
    };
    const attrs = genAiSpanAttributes(entry);
    expect(attrs["agent.cost.tokens"]).toBe(321);
    expect(attrs["agent.error"]).toBe(true);
    expect(attrs["agent.error.message"]).toBe("boom");
    expect(attrs.customFlag).toBe("on");
    // Canonical gen_ai.system still derived once (from the raw key).
    expect(attrs["gen_ai.system"]).toBe("openai");
  });

  it("exportTraces is a safe no-op when not configured", async () => {
    createOperatorSpan("llm", "generate").end();
    const result = await exportTraces();
    expect(result.configured).toBe(false);
    expect(result.exported).toBe(0);
    // In-memory store is untouched by a no-op export.
    expect(getTraces()).toHaveLength(1);
    expect(exportedSpans).toHaveLength(0);
  });

  it("exports spans with absolute timestamps, parent linkage, resource and attributes", async () => {
    // configureOpenTelemetry lazily imports the real OTel SDK packages at call
    // time, which is slow on a cold module cache — allow generous headroom.
    const parent = createOperatorSpan("pipeline", "run");
    parent.setAttribute("model", "gpt-4o");
    parent.end();
    const child = createOperatorSpan("llm", "generate", parent.spanId);
    child.setAttribute("model", "gpt-4o");
    child.setAttribute("inputTokens", 10);
    trackError(child, new Error("downstream failure"));
    child.end();

    // Capture the authoritative epoch timestamps the store recorded.
    const traces = getTraces();
    const parentEntry = traces.find((t) => t.spanId === parent.spanId)!;
    const childEntry = traces.find((t) => t.spanId === child.spanId)!;

    await configureOpenTelemetry({
      endpoint: "http://127.0.0.1:4318/v1/traces",
      serviceName: "weft-test",
    });

    const result = await exportTraces();
    expect(result.configured).toBe(true);
    expect(result.exported).toBe(2);
    // Additive: the in-memory trace store is preserved after export.
    expect(getTraces()).toHaveLength(2);

    expect(exportedSpans).toHaveLength(2);
    const parentSpan = exportedSpans.find((s) => s.name === "pipeline:run")!;
    const childSpan = exportedSpans.find((s) => s.name === "llm:generate")!;
    expect(parentSpan).toBeDefined();
    expect(childSpan).toBeDefined();

    // Absolute timestamps: Date-wrapped epoch ms round-trips exactly. A raw
    // number would be treated as hrtime-relative and diverge from startedAt.
    expect(hrTimeToMs(parentSpan.startTime)).toBe(parentEntry.startedAt);
    expect(hrTimeToMs(parentSpan.endTime)).toBe(parentEntry.endedAt!);
    expect(hrTimeToMs(childSpan.startTime)).toBe(childEntry.startedAt);
    expect(hrTimeToMs(childSpan.endTime)).toBe(childEntry.endedAt!);

    // Parent linkage: child points at the parent span, parent is a root.
    expect(childSpan.parentSpanContext?.spanId).toBe(
      parentSpan.spanContext().spanId,
    );
    expect(parentSpan.parentSpanContext).toBeUndefined();

    // Service resource set from serviceName.
    expect(parentSpan.resource.attributes["service.name"]).toBe("weft-test");

    // Custom + error attributes reach the span (not just gen_ai.* keys).
    expect(childSpan.attributes["gen_ai.request.model"]).toBe("gpt-4o");
    expect(childSpan.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(childSpan.attributes["agent.error"]).toBe(true);
    expect(childSpan.attributes["agent.error.message"]).toBe(
      "downstream failure",
    );
    expect(childSpan.attributes["weft.operator.type"]).toBe("llm");
  });
});
