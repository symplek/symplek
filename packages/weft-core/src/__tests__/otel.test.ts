/**
 * OpenTelemetry Export Contract Test — weft-core
 *
 * Verifies the additive OTLP export layer:
 *  - gen_ai semantic-convention attribute mapping (pure, dependency-free)
 *  - configure + export against an OTLP endpoint does not throw
 *  - the in-memory API is untouched (additive guarantee)
 *
 * Imports ONLY from "../index" (the package entrypoint).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearTraces,
  configureOpenTelemetry,
  createOperatorSpan,
  exportTraces,
  genAiSpanAttributes,
  getTraces,
  shutdownOpenTelemetry,
  type TraceEntry,
} from "../index";

describe("weft-core — OpenTelemetry export contract", () => {
  beforeEach(() => {
    clearTraces();
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

  it("exportTraces is a safe no-op when not configured", async () => {
    createOperatorSpan("llm", "generate").end();
    const result = await exportTraces();
    expect(result.configured).toBe(false);
    expect(result.exported).toBe(0);
    // In-memory store is untouched by a no-op export.
    expect(getTraces()).toHaveLength(1);
  });

  it("configure + export does not throw and reports converted spans", async () => {
    const parent = createOperatorSpan("pipeline", "run");
    parent.setAttribute("model", "gpt-4o");
    parent.end();
    const child = createOperatorSpan("llm", "generate", parent.spanId);
    child.setAttribute("model", "gpt-4o");
    child.setAttribute("inputTokens", 10);
    child.end();

    await configureOpenTelemetry({
      endpoint: "http://127.0.0.1:4318/v1/traces",
      serviceName: "weft-test",
    });

    const result = await exportTraces();
    expect(result.configured).toBe(true);
    expect(result.exported).toBe(2);
    // Additive: the in-memory trace store is preserved after export.
    expect(getTraces()).toHaveLength(2);
  });
});
