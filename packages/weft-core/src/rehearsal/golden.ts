/**
 * @module weft-core/rehearsal/golden
 * @description Golden trace format — record once, replay infinitely, zero tokens.
 *   A GoldenTrace is an ExecutionTrace designated as a committed test oracle.
 *   Contract fields (schemaVersion, finalOutputHash, expectedLlmCallCount) are
 *   stable across schema versions and safe to diff in CI.
 * @rules @.claude/rules/patterns/316-file-header-contracts.md
 */

import { createHash } from "node:crypto";
import type { AgentUnit } from "../AgentUnit/AgentUnit";
import { createTrackedResult } from "../trust";
import type { AgentContext, TrackedResult } from "../types";
import type { RecordedLLMCall } from "./interceptor";
import { FileStorage } from "./storage";
import { TraceReplayer } from "./replayer";
import type { Divergence, ExecutionTrace } from "./types";
import { TRACE_SCHEMA_VERSION, TraceVersionError } from "./types";

// ─── HASH HELPERS ─────────────────────────────────────────────────────────────

/**
 * SHA-256 hex of a UTF-8 string.
 * Used for golden contract finalOutputHash (stronger than internal DJB2).
 */
function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Apply regex redaction patterns to a string. */
function applyRedact(value: string, patterns: RegExp[]): string {
  let result = value;
  for (const p of patterns) {
    result = result.replace(p, "[REDACTED]");
  }
  return result;
}

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
 * const golden = toGoldenTrace(trace);
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
 * Computes contract fields and marks the trace as a test oracle.
 *
 * Optionally accepts redactPatterns to scrub secrets from finalOutput before
 * hashing. The redacted output is stored in the returned trace — the original
 * is not mutated.
 *
 * @param trace - A recorded ExecutionTrace (e.g. from .rehearse().run(ctx))
 * @param options.redactPatterns - Regex patterns to apply to serialized finalOutput
 *
 * @example
 * ```typescript
 * const golden = toGoldenTrace(trace, {
 *   redactPatterns: [/sk-[a-z0-9]+/gi], // redact API keys
 * });
 * ```
 */
export function toGoldenTrace<T>(
  trace: ExecutionTrace<T>,
  options?: { redactPatterns?: RegExp[] },
): GoldenTrace<T> {
  const patterns = options?.redactPatterns ?? [];
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

  const finalOutputHash = sha256hex(JSON.stringify(finalOutput));
  const expectedLlmCallCount = trace.events.filter(
    (e) => e.type === "llm_call",
  ).length;

  return {
    ...trace,
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
 * Use with ReplayLLMInterceptor to build a replay-mode interceptor:
 *
 * ```typescript
 * const calls = extractLLMCallsFromTrace(golden);
 * const interceptor = new ReplayLLMInterceptor(calls);
 * ```
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
 * The model is NEVER called during replay — all LLM responses come from the
 * recorded trace. When the trace's event hashes, final-output hash, and LLM call
 * count all match the golden contract, `matched` is true.
 *
 * When `schemaVersion` mismatches and no migration is registered, throws
 * `TraceVersionError`. Register a migration with `registerTraceMigration()` or
 * re-record the golden trace.
 *
 * Works for Weft-native agents and for weft-harness-wrapped SDK agents via
 * `AgentUnitHarness.withInterceptor(new ReplayLLMInterceptor(calls))`.
 *
 * @param options.trace - Path to committed trace file, or a GoldenTrace object
 * @param options.factory - Factory producing the AgentUnit under test (type witness)
 * @param options.context - Optional AgentContext override
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

  // ── 3. Replay via TraceReplayer (zero LLM calls) ─────────────────────────
  const replayer = new TraceReplayer<T>(golden);
  const replayResult = await replayer.replay();

  // ── 4. Collect divergences from replay + golden contract checks ───────────
  const divergences: Divergence[] = [...replayResult.divergences];

  // 4a. finalOutputHash: SHA-256 of stored finalOutput must match contract
  const actualHash = sha256hex(JSON.stringify(golden.finalOutput));
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

  // 4b. LLM call count must match expected
  const actualLlmCalls = golden.events.filter(
    (e) => e.type === "llm_call",
  ).length;
  if (actualLlmCalls !== golden.contract.expectedLlmCallCount) {
    divergences.push({
      eventId: "golden:llmCallCount",
      expected: golden.contract.expectedLlmCallCount,
      actual: actualLlmCalls,
      severity: "critical",
      description:
        `LLM call count mismatch: ` +
        `expected ${golden.contract.expectedLlmCallCount}, ` +
        `got ${actualLlmCalls}. ` +
        `The agent made a different number of model calls.`,
    });
  }

  // ── 5. Determine match status ─────────────────────────────────────────────
  const hasCritical = divergences.some((d) => d.severity === "critical");
  const matched = !hasCritical;

  // ── 6. Wrap finalOutput in a genuine TrackedResult ────────────────────────
  const result = createTrackedResult<T>(golden.finalOutput, {
    source: "agent",
    confidence: matched ? 1 : 0,
  });

  return { result, matched, divergences };
}
