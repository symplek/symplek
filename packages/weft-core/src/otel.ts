/**
 * @fileoverview OpenTelemetry Export (additive observability layer)
 * @module weft-core/otel
 * @description Exports the in-memory trace store as OTLP spans using
 *   gen_ai semantic conventions. The OpenTelemetry packages are OPTIONAL
 *   peer dependencies — they are loaded lazily via dynamic import only when
 *   {@link configureOpenTelemetry} is called, so importing weft-core never
 *   pulls OTel into a bundle and the browser entrypoint stays clean.
 * @rules @.claude/rules/frameworks/weft/weft-no-duplicate-analysis.md
 * @since 1.0.0-beta.1
 */

import { WeftError } from "./errors";
import { getTraces } from "./observability";
import type { TraceEntry } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Options for wiring weft traces to an OTLP collector. */
export interface OpenTelemetryOptions {
  /** OTLP HTTP traces endpoint, e.g. "http://localhost:4318/v1/traces". */
  endpoint: string;
  /** Logical service name reported on every span (default: "weft"). */
  serviceName?: string;
  /** Optional headers (auth tokens, tenant ids) sent with each OTLP request. */
  headers?: Record<string, string>;
}

/** Result of an {@link exportTraces} call. */
export interface OtelExportResult {
  /** Number of trace entries converted to OTLP spans. */
  exported: number;
  /** False when OpenTelemetry was never configured (export is a no-op). */
  configured: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// gen_ai SEMANTIC CONVENTIONS
// ─────────────────────────────────────────────────────────────────────────────

/** Attribute value types accepted by the OTel API. */
type OtelAttributeValue = string | number | boolean;

/**
 * Map a {@link TraceEntry} to OpenTelemetry gen_ai semantic-convention
 * attributes. Pure and dependency-free so it is unit-testable without the
 * optional OTel packages installed.
 *
 * Source keys are matched leniently (camelCase, gen_ai.*, and the existing
 * `agent.cost.*` keys written by {@link trackCost}) so callers using any of
 * the established conventions are covered.
 */
export function genAiSpanAttributes(
  entry: TraceEntry,
): Record<string, OtelAttributeValue> {
  const a = entry.attributes ?? {};
  const out: Record<string, OtelAttributeValue> = {
    "weft.operator.type": entry.operatorType,
    "weft.operator.name": entry.operatorName,
  };

  // Pass through arbitrary scalar attributes recorded via setAttribute —
  // custom data, `agent.cost.*` tokens, and `agent.error.*` from trackError()
  // would otherwise never reach the collector. Raw `gen_ai.*` keys are skipped
  // because their canonical forms are derived explicitly below.
  for (const [key, value] of Object.entries(a)) {
    if (key.startsWith("gen_ai.")) continue;
    if (isScalar(value)) out[key] = value;
  }

  const system = a.system ?? a.provider ?? a["gen_ai.system"];
  if (isScalar(system)) out["gen_ai.system"] = system;

  const requestModel =
    a.model ?? a.requestModel ?? a["gen_ai.request.model"] ?? a["agent.cost.model"];
  if (isScalar(requestModel)) out["gen_ai.request.model"] = requestModel;

  const responseModel =
    a.responseModel ?? a["gen_ai.response.model"] ?? a["agent.cost.model"];
  if (isScalar(responseModel)) out["gen_ai.response.model"] = responseModel;

  const inputTokens =
    a.inputTokens ?? a.promptTokens ?? a["gen_ai.usage.input_tokens"];
  if (isNumber(inputTokens)) out["gen_ai.usage.input_tokens"] = inputTokens;

  const outputTokens =
    a.outputTokens ?? a.completionTokens ?? a["gen_ai.usage.output_tokens"];
  if (isNumber(outputTokens)) out["gen_ai.usage.output_tokens"] = outputTokens;

  return out;
}

function isScalar(v: unknown): v is string | number | boolean {
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Source-attribute keys consumed by {@link genAiSpanAttributes}. Excluded from
 * {@link passthroughSpanAttributes} so the same value is not emitted twice
 * (once mapped to a `gen_ai.*` key, once raw).
 */
const GEN_AI_SOURCE_KEYS: ReadonlySet<string> = new Set([
  "system",
  "provider",
  "gen_ai.system",
  "model",
  "requestModel",
  "gen_ai.request.model",
  "agent.cost.model",
  "responseModel",
  "gen_ai.response.model",
  "inputTokens",
  "promptTokens",
  "gen_ai.usage.input_tokens",
  "outputTokens",
  "completionTokens",
  "gen_ai.usage.output_tokens",
]);

/**
 * Pass remaining scalar attributes on a {@link TraceEntry} through to the span
 * verbatim — arbitrary `setAttribute()` data plus the `agent.cost.*` and
 * `agent.error.*` fields written by `trackCost`/`trackError` that the gen_ai
 * mapping does not cover. Keys already consumed by {@link genAiSpanAttributes}
 * are skipped; non-scalar values are dropped (the OTel API rejects them).
 */
export function passthroughSpanAttributes(
  entry: TraceEntry,
): Record<string, OtelAttributeValue> {
  const out: Record<string, OtelAttributeValue> = {};
  for (const [key, value] of Object.entries(entry.attributes ?? {})) {
    if (GEN_AI_SOURCE_KEYS.has(key)) continue;
    if (isScalar(value)) out[key] = value;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER STATE (lazy)
// ─────────────────────────────────────────────────────────────────────────────

interface OtelRuntime {
  // biome-ignore lint/suspicious/noExplicitAny: OTel types are optional at compile time.
  provider: any;
  // biome-ignore lint/suspicious/noExplicitAny: OTel types are optional at compile time.
  tracer: any;
  // biome-ignore lint/suspicious/noExplicitAny: OTel API namespace, optional at compile time.
  api: any;
}

let runtime: OtelRuntime | null = null;

/**
 * Configure OTLP span export. Lazily imports the optional OpenTelemetry
 * packages, builds a `NodeTracerProvider` wired to an OTLP/HTTP exporter,
 * and stores a tracer for {@link exportTraces}.
 *
 * @throws {WeftError} SETUP_ERROR if the optional `@opentelemetry/*` packages
 *   are not installed.
 *
 * @example
 * ```typescript
 * await configureOpenTelemetry({
 *   endpoint: "http://localhost:4318/v1/traces",
 *   serviceName: "my-agent",
 *   headers: { authorization: "Bearer ..." },
 * });
 * await exportTraces();
 * ```
 */
export async function configureOpenTelemetry(
  options: OpenTelemetryOptions,
): Promise<void> {
  const [api, sdkNode, otlp, resources] = await loadOtel();

  const resource = resources.resourceFromAttributes({
    "service.name": options.serviceName ?? "weft",
  });

  const exporter = new otlp.OTLPTraceExporter({
    url: options.endpoint,
    headers: options.headers,
  });

  const provider = new sdkNode.NodeTracerProvider({
    resource,
    spanProcessors: [new sdkNode.SimpleSpanProcessor(exporter)],
  });

  runtime = {
    provider,
    tracer: provider.getTracer("weft-core"),
    api,
  };
}

/**
 * Export every recorded {@link TraceEntry} as an OTLP span. Each entry without
 * a `parentSpanId` becomes a root span (an AgentUnit run); entries with a
 * `parentSpanId` are nested as child spans (operator executions). Original
 * start/end timestamps are preserved. No-op (returns `configured: false`) when
 * {@link configureOpenTelemetry} was never called.
 */
export async function exportTraces(): Promise<OtelExportResult> {
  if (!runtime) {
    return { exported: 0, configured: false };
  }

  const { tracer, api, provider } = runtime;
  const entries = getTraces();
  const byId = new Map<string, TraceEntry>();
  for (const e of entries) byId.set(e.spanId, e);

  // biome-ignore lint/suspicious/noExplicitAny: OTel Span type optional at compile time.
  const built = new Map<string, any>();

  // Cap parent-chain recursion as a backstop against pathological nesting.
  const MAX_DEPTH = 256;

  // biome-ignore lint/suspicious/noExplicitAny: OTel Span type optional at compile time.
  const build = (entry: TraceEntry, ancestors: Set<string> = new Set()): any => {
    const existing = built.get(entry.spanId);
    if (existing) return existing;

    let ctx = api.context.active();
    // Establish parent context only when the parent is a real, non-cyclic
    // ancestor. `ancestors` tracks the spans currently on the build stack so a
    // self-parent or a parent→child→parent cycle degrades to a root span
    // instead of recursing forever.
    if (entry.parentSpanId && ancestors.size < MAX_DEPTH) {
      const parentEntry = byId.get(entry.parentSpanId);
      if (
        parentEntry &&
        parentEntry.spanId !== entry.spanId &&
        !ancestors.has(parentEntry.spanId)
      ) {
        ctx = api.trace.setSpan(
          ctx,
          build(parentEntry, new Set(ancestors).add(entry.spanId)),
        );
      }
    }

    // OTel JS treats raw numbers as hrtime-relative; epoch ms must be wrapped
    // in `Date` so the SDK records the correct absolute timestamp.
    const span = tracer.startSpan(
      `${entry.operatorType}:${entry.operatorName}`,
      { startTime: new Date(entry.startedAt) },
      ctx,
    );
    span.setAttributes(genAiSpanAttributes(entry));
    span.setAttributes(passthroughSpanAttributes(entry));
    span.end(new Date(entry.endedAt ?? entry.startedAt));
    built.set(entry.spanId, span);
    return span;
  };

  for (const entry of entries) build(entry);

  await provider.forceFlush();
  return { exported: entries.length, configured: true };
}

/**
 * Tear down the configured provider (flushes and shuts down the exporter).
 * Primarily for tests and graceful shutdown. Safe to call when unconfigured.
 */
export async function shutdownOpenTelemetry(): Promise<void> {
  if (!runtime) return;
  const { provider } = runtime;
  runtime = null;
  await provider.shutdown();
}

// ─────────────────────────────────────────────────────────────────────────────
// LAZY LOADER
// ─────────────────────────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: optional peer modules, typed at runtime.
async function loadOtel(): Promise<[any, any, any, any]> {
  try {
    const [api, sdkNode, otlp, resources] = await Promise.all([
      import("@opentelemetry/api"),
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
    ]);
    return [api, sdkNode, otlp, resources];
  } catch (cause) {
    throw new WeftError({
      code: "SETUP_ERROR",
      why: "OpenTelemetry export requires the optional @opentelemetry/* peer dependencies, which are not installed.",
      fix: {
        description:
          "Install the OpenTelemetry peer dependencies to enable OTLP export.",
        docsUrl: "https://github.com/wefthq/weft#opentelemetry-export",
      },
      example:
        "npm install @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources",
      cause,
    });
  }
}
