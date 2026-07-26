/**
 * @module weft-core/rehearsal/golden
 * @description Golden trace format — record once, replay infinitely, zero tokens.
 *   A GoldenTrace is an ExecutionTrace designated as a committed test oracle.
 *   Contract fields (schemaVersion, finalOutputHash, expectedLlmCallCount) are
 *   stable across schema versions and safe to diff in CI.
 *
 *   Secret safety: when `redactPatterns` are supplied to `toGoldenTrace`, they
 *   are applied to ALL sensitive event payload fields (prompt, systemPrompt,
 *   response) AND to finalOutput, so no secret survives into the committed file.
 *
 *   Replay correctness: `replayAgentWithTrace` actually executes the supplied
 *   factory, injects a `ReplayLLMInterceptor` via the context so no live model
 *   call is made, and compares the resulting output and call profile against the
 *   golden contract.  A changed factory will produce a divergence.
 * @rules @.claude/rules/patterns/316-file-header-contracts.md
 */

import { createHash } from "node:crypto";
import type { AgentUnit } from "../AgentUnit/AgentUnit";
import { createTrackedResult } from "../trust";
import type { AgentContext, TrackedResult } from "../types";
import { ReplayLLMInterceptor, type RecordedLLMCall } from "./interceptor";
import { FileStorage } from "./storage";
import type { Divergence, ExecutionTrace, TraceEvent } from "./types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "./types";

// ─── HASH HELPERS ─────────────────────────────────────────────────────────────

/**
 * SHA-256 hex of a UTF-8 string.
 * Used for golden contract finalOutputHash (stronger than internal DJB2).
 */
function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Credential shapes stripped from every golden trace by default.
 *
 * A golden trace is committed to the caller's repository, so the safe default
 * is to redact without being asked. This list is deliberately conservative —
 * it targets shapes that are unambiguously credentials, so it will not mangle
 * ordinary prose. It is a **floor, not a guarantee**: a caller whose secrets do
 * not match these shapes must supply `redactPatterns` of their own.
 *
 * Opt out with `useDefaultRedactions: false` when a trace is known to contain
 * no credentials and the substitutions are unwanted.
 */
export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style secret keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic keys
  /\bAIza[A-Za-z0-9_-]{20,}\b/g, // Google API keys
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub personal access tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, // Bearer credentials
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, // JWTs
];

/** Apply regex redaction patterns to a string. */
function applyRedact(value: string, patterns: RegExp[]): string {
  let result = value;
  for (const p of patterns) {
    result = result.replace(p, "[REDACTED]");
  }
  return result;
}

// ─── EVENT REDACTION ──────────────────────────────────────────────────────────

/**
 * DJB2 hash — mirrors recorder.ts algorithm exactly.
 * Used to recompute event hashes after payload redaction so event integrity
 * checks pass on the committed trace.
 */
function djb2Hash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Recompute the integrity hash for an event after its payload was modified. */
function recomputeEventHash(event: TraceEvent): TraceEvent {
  const content = JSON.stringify({
    id: event.id,
    type: event.type,
    agentId: event.agentId,
    timestamp: event.timestamp,
    vectorClock: event.vectorClock,
    payload: event.payload,
  });
  return { ...event, hash: djb2Hash(content) };
}

/**
 * Redact sensitive payload fields in an event and recompute its hash.
 *
 * - `llm_call`: redacts `prompt` and `systemPrompt`.
 * - `llm_response`: redacts `response`.
 * - All other event types: returned unchanged.
 *
 * The hash is recomputed after redaction so `TraceReplayer.verifyEventIntegrity`
 * still passes on the committed golden trace.
 */
function redactEventPayload(event: TraceEvent, patterns: RegExp[]): TraceEvent {
  if (event.type === "llm_call") {
    const p = event.payload as unknown as Record<string, unknown>;
    const newPayload: Record<string, unknown> = {
      ...p,
      ...(typeof p.prompt === "string" && {
        prompt: applyRedact(p.prompt, patterns),
      }),
      ...(typeof p.systemPrompt === "string" && {
        systemPrompt: applyRedact(p.systemPrompt, patterns),
      }),
    };
    return recomputeEventHash({
      ...event,
      // TraceEvent is not a discriminated union — `type` and `payload` are
      // independent, so narrowing on `type` cannot narrow the payload. The
      // spread preserves every original field and only replaces two strings
      // with redacted strings, so the shape is unchanged.
      payload: newPayload as unknown as TraceEvent["payload"],
    });
  }
  if (event.type === "llm_response") {
    const p = event.payload as unknown as Record<string, unknown>;
    const newPayload: Record<string, unknown> = {
      ...p,
      ...(typeof p.response === "string" && {
        response: applyRedact(p.response, patterns),
      }),
    };
    return recomputeEventHash({
      ...event,
      // TraceEvent is not a discriminated union — `type` and `payload` are
      // independent, so narrowing on `type` cannot narrow the payload. The
      // spread preserves every original field and only replaces two strings
      // with redacted strings, so the shape is unchanged.
      payload: newPayload as unknown as TraceEvent["payload"],
    });
  }
  return event;
}

// ─── REPLAY CONTEXT KEY ───────────────────────────────────────────────────────

/**
 * The `AgentContext.extensions` key under which `replayAgentWithTrace` injects
 * a `ReplayLLMInterceptor`.  Agents designed to support zero-token replay should
 * check for this key before making live provider calls:
 *
 * ```typescript
 * const interceptor = ctx.extensions?.[WEFT_REPLAY_INTERCEPTOR_KEY] as
 *   ReplayLLMInterceptor | undefined;
 * if (interceptor) {
 *   return (await interceptor.replayCall({ model, prompt })).response;
 * }
 * return await realProviderCall(model, prompt);
 * ```
 */
export const WEFT_REPLAY_INTERCEPTOR_KEY = "_weftReplayInterceptor";

// ─── MIGRATION REGISTRY ───────────────────────────────────────────────────────

type MigrationFn = (trace: ExecutionTrace<unknown>) => ExecutionTrace<unknown>;
const _migrations = new Map<string, MigrationFn>();

/**
 * Register a migration function for a schema version delta.
 * Called by replayAgentWithTrace() on version mismatch before throwing TraceVersionError.
 *
 * @example
 * ```typescript
 * registerTraceMigration("0.9.0", "1.0.0", (trace) => ({
 *   ...trace, version: "1.0.0" as const,
 * }));
 * ```
 */
export function registerTraceMigration(
  fromVersion: string,
  toVersion: string,
  migrate: (trace: ExecutionTrace<unknown>) => ExecutionTrace<unknown>,
): void {
  _migrations.set(`${fromVersion}->${toVersion}`, migrate);
}

/** @internal Reset migrations between tests. */
export function _clearMigrationsForTest(): void {
  _migrations.clear();
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

/**
 * The stable contract fields committed to a repository.
 * These fields are safe to diff in CI across code changes.
 */
export interface GoldenTraceContract {
  /**
   * schemaVersion at recording time.
   * Replay throws TraceVersionError if version mismatches and no migration exists.
   */
  readonly schemaVersion: string;
  /**
   * SHA-256 hex of JSON.stringify(finalOutput).
   * Primary assertion target: if this changes, the agent's output changed.
   */
  readonly finalOutputHash: string;
  /**
   * Expected number of LLM calls.
   * Diverges if the agent makes a different number of model calls.
   */
  readonly expectedLlmCallCount: number;
}

/**
 * An ExecutionTrace designated as a committed test oracle.
 *
 * Commit this to your repository; assert against it in CI at zero token cost.
 *
 * @example
 * ```typescript
 * // Record once (dev machine with a real API key):
 * const { trace } = await unit.rehearse().run(ctx);
 * const golden = toGoldenTrace(trace, { redactPatterns: [/sk-[a-z0-9]+/gi] });
 * await saveTrace(golden, "__traces__/my-agent-golden");
 *
 * // CI assertion (zero API calls, zero tokens):
 * const { matched, divergences } = await replayAgentWithTrace({
 *   trace: "__traces__/my-agent-golden.trace.json",
 *   factory: () => myAgentUnit,
 * });
 * if (!matched) throw new Error(divergences.map(d => d.description).join("\n"));
 * ```
 */
export interface GoldenTrace<T> extends ExecutionTrace<T> {
  /** Marks this trace as a committed test oracle. */
  readonly golden: true;
  /** The stable contract fields. Diff these in code review. */
  readonly contract: GoldenTraceContract;
}

// ─── TO GOLDEN TRACE ──────────────────────────────────────────────────────────

/**
 * Designate an ExecutionTrace as a golden trace.
 *
 * Computes contract fields and marks the trace as a test oracle. When
 * `redactPatterns` are provided they are applied to **all** sensitive event
 * payload fields (`llm_call.prompt`, `llm_call.systemPrompt`,
 * `llm_response.response`) AND to `finalOutput`, so no secret survives into the
 * committed file. Event hashes are recomputed after redaction to keep the
 * integrity check in TraceReplayer working.
 *
 * @param trace - A recorded ExecutionTrace (e.g. from .rehearse().run(ctx))
 * @param options.redactPatterns - Regex patterns applied to ALL sensitive fields
 *
 * @example
 * ```typescript
 * const golden = toGoldenTrace(trace, {
 *   redactPatterns: [/sk-[a-z0-9]+/gi], // redacts API keys in prompts, responses, and output
 * });
 * ```
 */
export function toGoldenTrace<T>(
  trace: ExecutionTrace<T>,
  options?: { redactPatterns?: RegExp[]; useDefaultRedactions?: boolean },
): GoldenTrace<T> {
  // A golden trace is written into the caller's repository, so the default is
  // safe-by-omission: the well-known credential shapes are always stripped
  // unless the caller explicitly opts out. Caller patterns extend, not replace,
  // that baseline. DEFAULT_SECRET_PATTERNS is best-effort and documented as
  // such — it is a floor, not a guarantee, and callers handling unusual secret
  // formats must still supply their own patterns.
  const useDefaults = options?.useDefaultRedactions !== false;
  const patterns = [
    ...(useDefaults ? DEFAULT_SECRET_PATTERNS : []),
    ...(options?.redactPatterns ?? []),
  ];

  // ── Redact finalOutput ─────────────────────────────────────────────────────
  const rawJson = JSON.stringify(trace.finalOutput);
  const redactedJson =
    patterns.length > 0 ? applyRedact(rawJson, patterns) : rawJson;

  // Parse the redacted JSON back to T so the stored finalOutput is the safe version.
  let finalOutput: T = trace.finalOutput;
  if (patterns.length > 0 && redactedJson !== rawJson) {
    try {
      finalOutput = JSON.parse(redactedJson) as T;
    } catch {
      // Non-parseable after redaction (e.g. a string type with embedded JSON).
      finalOutput = redactedJson as unknown as T;
    }
  }

  // ── Redact event payloads ──────────────────────────────────────────────────
  // Applied to llm_call (prompt, systemPrompt) and llm_response (response) so
  // that secrets in prompts and model responses are scrubbed from the committed
  // file, not only from finalOutput.
  const events =
    patterns.length > 0
      ? trace.events.map((e) => redactEventPayload(e, patterns))
      : trace.events;

  const finalOutputHash = sha256hex(JSON.stringify(finalOutput));
  const expectedLlmCallCount = trace.events.filter(
    (e) => e.type === "llm_call",
  ).length;

  return {
    ...trace,
    events,
    finalOutput,
    golden: true,
    contract: {
      schemaVersion: trace.version,
      finalOutputHash,
      expectedLlmCallCount,
    },
  };
}

// ─── EXTRACT LLM CALLS ────────────────────────────────────────────────────────

/**
 * Extract RecordedLLMCall entries from a trace.
 * Used by replayAgentWithTrace to seed the ReplayLLMInterceptor.
 */
export function extractLLMCallsFromTrace<T>(
  trace: ExecutionTrace<T>,
): RecordedLLMCall[] {
  const calls: RecordedLLMCall[] = [];
  let pending: Partial<RecordedLLMCall> | null = null;

  for (const event of trace.events) {
    if (event.type === "llm_call") {
      const p = event.payload as unknown as Record<string, unknown>;
      pending = {
        config: {
          model: p.model as string,
          prompt: (p.prompt as string) ?? "",
          systemPrompt: p.systemPrompt as string | undefined,
          temperature: p.temperature as number | undefined,
          maxTokens: p.maxTokens as number | undefined,
        },
        configHash: p.promptHash as string,
      };
    } else if (event.type === "llm_response" && pending) {
      const p = event.payload as unknown as Record<string, unknown>;
      pending.response = {
        response: (p.response as string) ?? "",
        tokensUsed: p.tokensUsed as number | undefined,
        finishReason: p.finishReason as string | undefined,
        latencyMs: (p.latencyMs as number) ?? 0,
      };
      pending.responseHash = p.responseHash as string;
      if (
        pending.config &&
        pending.response &&
        pending.configHash &&
        pending.responseHash
      ) {
        calls.push(pending as RecordedLLMCall);
      }
      pending = null;
    }
  }
  return calls;
}

// ─── REPLAY AGENT WITH TRACE ──────────────────────────────────────────────────

/**
 * Replay a golden trace as a CI assertion at zero token cost.
 *
 * Executes the supplied `factory` with a `ReplayLLMInterceptor` injected via
 * `AgentContext.extensions[WEFT_REPLAY_INTERCEPTOR_KEY]`.  Agents that check
 * for this key will receive recorded provider responses instead of making live
 * model calls.  Agents that make no LLM calls at all (e.g. `AgentUnit.of(...)`)
 * satisfy the zero-token guarantee trivially.
 *
 * Two properties are asserted:
 * 1. **Output hash**: `sha256(JSON.stringify(factoryOutput)) === contract.finalOutputHash`
 * 2. **LLM call count**: calls consumed from the interceptor === `contract.expectedLlmCallCount`
 *
 * When `schemaVersion` mismatches and no migration is registered, throws
 * `TraceVersionError`. Register a migration with `registerTraceMigration()` or
 * re-record the golden trace.
 *
 * @param options.trace - Path to committed trace file, or a GoldenTrace object
 * @param options.factory - Factory producing the AgentUnit under test
 * @param options.context - Optional AgentContext (interceptor is merged in)
 * @param options.basePath - Override base path when trace is a string path
 */
export async function replayAgentWithTrace<T>(options: {
  trace: string | GoldenTrace<T>;
  factory: () => AgentUnit<T>;
  context?: AgentContext;
  basePath?: string;
}): Promise<{
  result: TrackedResult<T>;
  matched: boolean;
  divergences: Divergence[];
}> {
  // ── 1. Load trace ──────────────────────────────────────────────────────────
  let golden: GoldenTrace<T>;

  if (typeof options.trace === "string") {
    const storage = new FileStorage({
      basePath: options.basePath ?? "__traces__",
    });
    const loaded = await storage.load<T>(options.trace);
    if (!(loaded as GoldenTrace<T>).golden) {
      throw new Error(
        `Trace at "${options.trace}" is not a golden trace. ` +
          `Designate it first with toGoldenTrace() before committing.`,
      );
    }
    golden = loaded as GoldenTrace<T>;
  } else {
    golden = options.trace;
  }

  // ── 2. Schema version check with migration ────────────────────────────────
  if (golden.version !== TRACE_SCHEMA_VERSION) {
    const migrationKey = `${golden.version}->${TRACE_SCHEMA_VERSION}`;
    const migrateFn = _migrations.get(migrationKey);
    if (!migrateFn) {
      const err = new TraceVersionError(golden.version, TRACE_SCHEMA_VERSION);
      err.message +=
        `. No migration registered for v${golden.version}→v${TRACE_SCHEMA_VERSION}; ` +
        `re-record the golden trace or call registerTraceMigration().`;
      throw err;
    }
    golden = migrateFn(golden as ExecutionTrace<unknown>) as GoldenTrace<T>;
  }

  // ── 3. Set up replay interceptor from recorded calls ──────────────────────
  // The interceptor serves recorded responses in call order so the factory can
  // run without a live provider connection.
  const recordedCalls = extractLLMCallsFromTrace(golden);
  const replayInterceptor = new ReplayLLMInterceptor(recordedCalls);

  // ── 4. Build execution context with interceptor injected ──────────────────
  const replayCtx: AgentContext = {
    timestamp: options.context?.timestamp ?? Date.now(),
    signal: options.context?.signal,
    extensions: {
      ...(options.context?.extensions ?? {}),
      [WEFT_REPLAY_INTERCEPTOR_KEY]: replayInterceptor,
    },
    idempotencyKey: options.context?.idempotencyKey,
  };

  // ── 5. Execute the factory ─────────────────────────────────────────────────
  // Running the factory is what makes replay meaningful: a changed agent
  // produces different output, which the contract check below will catch.
  const unit = options.factory();
  const divergences: Divergence[] = [];

  let actualOutput: T | undefined;
  let factorySucceeded = false;

  try {
    const trackedResult = await unit.run(replayCtx);
    actualOutput = trackedResult.value;
    factorySucceeded = true;
  } catch (error) {
    divergences.push({
      eventId: "golden:factoryError",
      expected: "successful execution",
      actual: String(error),
      severity: "critical",
      description:
        `Factory threw during replay: ${String(error)}. ` +
        `The agent may have changed or the replay interceptor was exhausted.`,
    });
  }

  // ── 6. Compare output hash ─────────────────────────────────────────────────
  if (factorySucceeded) {
    const actualHash = sha256hex(JSON.stringify(actualOutput));
    if (actualHash !== golden.contract.finalOutputHash) {
      divergences.push({
        eventId: "golden:finalOutputHash",
        expected: golden.contract.finalOutputHash,
        actual: actualHash,
        severity: "critical",
        description:
          `Final output hash mismatch: ` +
          `expected ${golden.contract.finalOutputHash.slice(0, 16)}…, ` +
          `got ${actualHash.slice(0, 16)}…. ` +
          `The agent's output changed — re-record or register a migration.`,
      });
    }
  }

  // ── 7. Compare LLM call count ─────────────────────────────────────────────
  // callsConsumed = how many recorded calls the factory actually used.
  // A mismatch means the agent's call profile changed since recording.
  const callsConsumed = recordedCalls.length - replayInterceptor.getRemainingCalls();
  if (callsConsumed !== golden.contract.expectedLlmCallCount) {
    divergences.push({
      eventId: "golden:llmCallCount",
      expected: golden.contract.expectedLlmCallCount,
      actual: callsConsumed,
      severity: "critical",
      description:
        `LLM call count mismatch: ` +
        `expected ${golden.contract.expectedLlmCallCount}, ` +
        `got ${callsConsumed}. ` +
        `The agent made a different number of model calls.`,
    });
  }

  // ── 8. Determine match status ─────────────────────────────────────────────
  const hasCritical = divergences.some((d) => d.severity === "critical");
  const matched = !hasCritical;

  // ── 9. Wrap result in a genuine TrackedResult ─────────────────────────────
  // Fall back to golden.finalOutput when the factory threw so callers always
  // receive a valid result object (with confidence: 0 indicating failure).
  const outputForResult = factorySucceeded
    ? (actualOutput as T)
    : golden.finalOutput;

  const result = createTrackedResult<T>(outputForResult, {
    source: "agent",
    confidence: matched ? 1 : 0,
  });

  return { result, matched, divergences };
}
