/**
 * Observability Contract Test — @weft/core
 *
 * Verifies the observability module exported from the package root.
 * Moved from @weft/pro in Phase 0 of the opencore release (2026-04-24)
 * so that basic trace recording is available in the free tier.
 *
 * Imports ONLY from "../index" (the package entrypoint).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TraceEntry } from "../index";
import {
  clearTraces,
  configureObservability,
  createOperatorSpan,
  getObservabilityConfig,
  getTraces,
  observable,
  trackCost,
  trackError,
} from "../index";

describe("@weft/core — Observability contract", () => {
  beforeEach(() => {
    clearTraces();
    configureObservability({
      verbosity: "detailed",
      trackCosts: true,
      trackErrors: true,
      collector: undefined,
    });
  });

  it("configureObservability persists and getObservabilityConfig reads back", () => {
    configureObservability({ verbosity: "full" });
    const config = getObservabilityConfig();
    expect(config.verbosity).toBe("full");
  });

  it("createOperatorSpan records a timed span with attributes", () => {
    const span = createOperatorSpan("llm", "generate");
    span.setAttribute("model", "gpt-4");
    span.end({ tokens: 150 });

    const traces = getTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].operatorType).toBe("llm");
    expect(traces[0].operatorName).toBe("generate");
    expect(traces[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(traces[0].attributes.model).toBe("gpt-4");
    expect(traces[0].attributes.tokens).toBe(150);
  });

  it("createOperatorSpan records parentSpanId when provided", () => {
    const parent = createOperatorSpan("pipeline", "root");
    parent.end();
    const child = createOperatorSpan("step", "transform", parent.spanId);
    child.end();

    const traces = getTraces();
    expect(traces).toHaveLength(2);
    expect(traces[1].parentSpanId).toBe(traces[0].spanId);
  });

  it("clearTraces empties the store and returns count", () => {
    createOperatorSpan("a", "b").end();
    createOperatorSpan("c", "d").end();
    expect(getTraces()).toHaveLength(2);

    const cleared = clearTraces();
    expect(cleared).toBe(2);
    expect(getTraces()).toHaveLength(0);
  });

  it("trackCost sets token attributes on a span", () => {
    const span = createOperatorSpan("llm", "call");
    trackCost(span, 500, "claude-3");
    span.end();

    const entry = getTraces()[0];
    expect(entry.attributes["agent.cost.tokens"]).toBe(500);
    expect(entry.attributes["agent.cost.model"]).toBe("claude-3");
  });

  it("trackError sets error attributes on a span", () => {
    const span = createOperatorSpan("llm", "call");
    trackError(span, new TypeError("boom"));
    span.end();

    const entry = getTraces()[0];
    expect(entry.attributes["agent.error"]).toBe(true);
    expect(entry.attributes["agent.error.message"]).toBe("boom");
    expect(entry.attributes["agent.error.name"]).toBe("TypeError");
  });

  it("collector callback receives span entries", () => {
    const collected: TraceEntry[] = [];
    configureObservability({
      collector: { onSpanEnd: (e) => collected.push(e) },
    });

    const span = createOperatorSpan("test", "collector");
    span.end();

    expect(collected).toHaveLength(1);
    expect(collected[0].operatorName).toBe("collector");
  });

  it("observable is a function (integration test requires AgentUnit.run)", () => {
    expect(typeof observable).toBe("function");
  });
});
