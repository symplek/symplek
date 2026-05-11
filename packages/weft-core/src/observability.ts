/**
 * @fileoverview Lightweight Observability (Free Tier)
 * @description In-process trace collection for agent compositions
 * @module weft-core/observability
 * @since 1.0.0-beta.1
 *
 * Provides an in-memory trace store that records span entries when
 * agent units execute. NOT an OpenTelemetry integration — this is a
 * lightweight, dependency-free trace collector useful for debugging,
 * testing, and feeding external systems via the `TraceCollector` hook.
 *
 * Advanced features (multi-agent trace aggregation, cost dashboards,
 * distributed tracing) will live in weft-pro when added.
 */

import type { AgentUnit } from "./AgentUnit";
import type {
  ObservabilityOptions,
  Span,
  TraceCollector,
  TraceEntry,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────────────────────

let observabilityConfig: ObservabilityOptions = {
  verbosity: "detailed",
  trackCosts: true,
  trackErrors: true,
};

const traceStore: TraceEntry[] = [];
let spanCounter = 0;

function generateSpanId(): string {
  return `span-${++spanCounter}-${Date.now().toString(36)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configure observability settings and optional trace collector.
 *
 * @example
 * ```typescript
 * import { configureObservability } from 'weft-core';
 *
 * configureObservability({
 *   verbosity: 'full',
 *   collector: { onSpanEnd: (entry) => console.log(entry) },
 * });
 * ```
 */
export function configureObservability(options: ObservabilityOptions): void {
  observabilityConfig = { ...observabilityConfig, ...options };
}

/** Get current observability configuration (defensive copy). */
export function getObservabilityConfig(): Readonly<ObservabilityOptions> {
  return { ...observabilityConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACE STORE ACCESS
// ─────────────────────────────────────────────────────────────────────────────

/** Return a snapshot of all recorded trace entries. */
export function getTraces(): readonly TraceEntry[] {
  return [...traceStore];
}

/** Clear the in-memory trace store. Returns the number of entries cleared. */
export function clearTraces(): number {
  const count = traceStore.length;
  traceStore.length = 0;
  spanCounter = 0;
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVABLE WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap an AgentUnit so that a trace entry is recorded when its result
 * flows through. Uses the `tap` operator — the original value is
 * unchanged; a {@link TraceEntry} is pushed to the in-memory store
 * and forwarded to any configured `collector`.
 *
 * This does NOT measure the inner computation's wall-clock time.
 * For manual timing, use {@link createOperatorSpan}.
 *
 * @example
 * ```typescript
 * import { observable, getTraces, clearTraces } from 'weft-core';
 *
 * const traced = observable(myUnit, { verbosity: 'full' });
 * await traced.run(ctx);
 *
 * console.log(getTraces()); // [{spanId, operatorType, ...}]
 * clearTraces();
 * ```
 */
export function observable<T>(
  unit: AgentUnit<T>,
  options?: ObservabilityOptions,
): AgentUnit<T> {
  const config = options
    ? { ...observabilityConfig, ...options }
    : observabilityConfig;

  const collector: TraceCollector | undefined =
    config.collector ?? observabilityConfig.collector;

  return unit.tap((result: T) => {
    const now = Date.now();

    const attributes: Record<string, unknown> = {
      verbosity: config.verbosity,
    };

    if (config.verbosity === "detailed" || config.verbosity === "full") {
      attributes.resultType = typeof result;
    }
    if (
      config.verbosity === "full" &&
      result !== null &&
      result !== undefined
    ) {
      attributes.resultKeys =
        typeof result === "object" ? Object.keys(result as object) : undefined;
    }

    const entry: TraceEntry = {
      spanId: generateSpanId(),
      operatorType: "unit",
      operatorName: "observable",
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      attributes,
    };

    traceStore.push(entry);
    collector?.onSpanEnd(entry);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL SPAN INSTRUMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a manually-timed span. Call `.end()` when the operation
 * completes to record wall-clock duration into the trace store.
 *
 * @example
 * ```typescript
 * const span = createOperatorSpan('llm', 'generate');
 * span.setAttribute('model', 'gpt-4');
 * const result = await callLLM(prompt);
 * span.end({ tokens: result.usage.total });
 *
 * getTraces(); // includes the timed span
 * ```
 */
export function createOperatorSpan(
  operatorType: string,
  operatorName: string,
  parentSpanId?: string,
): Span {
  const spanId = generateSpanId();
  const startedAt = Date.now();
  const attributes: Record<string, unknown> = {};

  const collector: TraceCollector | undefined = observabilityConfig.collector;

  return {
    spanId,
    setAttribute(key: string, value: unknown) {
      attributes[key] = value;
    },
    end(endAttributes?: Record<string, unknown>) {
      const endedAt = Date.now();
      if (endAttributes) {
        Object.assign(attributes, endAttributes);
      }

      const entry: TraceEntry = {
        spanId,
        operatorType,
        operatorName,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        parentSpanId,
        attributes,
      };

      traceStore.push(entry);
      collector?.onSpanEnd(entry);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPAN ATTRIBUTE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Record token cost on a span. Works with any object exposing `setAttribute`. */
export function trackCost(
  span: { setAttribute: (key: string, value: unknown) => void },
  tokens: number,
  model?: string,
): void {
  span.setAttribute("agent.cost.tokens", tokens);
  if (model) {
    span.setAttribute("agent.cost.model", model);
  }
}

/** Record an error on a span. Works with any object exposing `setAttribute`. */
export function trackError(
  span: { setAttribute: (key: string, value: unknown) => void },
  error: Error,
): void {
  span.setAttribute("agent.error", true);
  span.setAttribute("agent.error.message", error.message);
  span.setAttribute("agent.error.name", error.name);
}
