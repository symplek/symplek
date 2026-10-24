/**
 * @module facade - Server-side callable namespace for @symplek/core
 * @description Real AI execution facade — SERVER-ONLY (Node.js / Convex Actions).
 *   Exports `Symplek` as a callable namespace with `.run()`, `.stream()`, `.agent()`,
 *   `.configure()`, and `.providers()` methods, while preserving the direct
 *   `Symplek(task)` call signature returning `SymplekBuilder<T>`.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @blast_radius MEDIUM
 * @status stable
 * @runtime node
 * @surface server:public
 */

import type { z } from "zod";
import type { AgentConfig } from "./agent";
import { AgentBuilder, createAgent } from "./agent";
import { AgentUnit } from "./AgentUnit";
import type { AgentComputation } from "./AgentUnit";
import { SymplekBuilder } from "./builder";
import { SymplekError } from "./errors";
import {
  getGlobalConfig,
  mergeGlobalConfig,
  resetAll,
  setInitPromise,
} from "./globalConfig";
import { createProviderAdapter } from "./providers/bootstrap";
import { getEnvKeyForProvider, KNOWN_PROVIDERS } from "./providers/known";
import { providerRegistry } from "./providers/registry";
import type { StreamOptions } from "./streaming";
import { stream } from "./streaming";
import { traceManager } from "./trace";
import type { TrackedResult } from "./types";

export type { SymplekOptions } from "./builder";
// Re-export for external consumers who previously imported from "./facade"
export { SymplekBuilder } from "./builder";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Namespace additions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-time global configuration for the Symplek facade.
 */
export interface SymplekConfigOptions {
  /** Provider identifier override (e.g. 'openai', 'anthropic'). */
  provider?: string;
  /** Model name override (e.g. 'gpt-4o'). */
  model?: string;
  /** API key override — stored in-memory only, never logged. */
  apiKey?: string;
  /** Enable debug-level logging. */
  debug?: boolean;
}

/**
 * Summary of a known or registered provider.
 */
export interface ProviderInfo {
  /** Provider identifier (e.g. 'openai'). */
  id: string;
  /** Human-readable provider name. */
  name: string;
  /** Whether this provider has an API key configured or is registered. */
  configured: boolean;
}

/**
 * The Symplek callable namespace type.
 * Supports direct call (returns SymplekBuilder) AND named methods.
 */
export interface SymplekFunction {
  /** Direct call returning a SymplekBuilder<string>. */
  (task: string): SymplekBuilder<string>;
  /** Direct call with schema returning a SymplekBuilder<T>. */
  <T>(
    task: string,
    options: import("./builder").SymplekOptions<T> & { schema: z.ZodType<T> },
  ): SymplekBuilder<T>;
  /** Direct call with options but no schema (model/timeout/etc overrides). */
  <T = string>(
    task: string,
    options: import("./builder").SymplekOptions<T>,
  ): SymplekBuilder<T>;
  /** Explicitly run a task. Equivalent to awaiting the direct call. */
  run(
    task: string,
    options?: import("./builder").SymplekOptions<unknown>,
  ): Promise<TrackedResult<unknown>>;
  /** Stream incremental text chunks from the AI provider. */
  stream(task: string, options?: StreamOptions): AsyncGenerator<string>;
  /** Create a fluent AgentBuilder with per-agent configuration. */
  agent(config?: AgentConfig): AgentBuilder;
  /**
   * Bridge into AgentUnit composition from the Symplek namespace. Equivalent to
   * `AgentUnit.from(computation)` — lets you reach `.consensus()`, `.zipAll()`,
   * `.retry()`, etc. without a second import. Complements `Symplek(task).coordinate()`
   * which bridges from a Symplek(task) call into the same AgentUnit composition.
   *
   * @example
   * ```typescript
   * const decision = await Symplek.unit(async () => "Ship the feature")
   *   .consensus([voter1, voter2, voter3])
   *   .run(ctx);
   * ```
   */
  unit<T>(computation: AgentComputation<T>): AgentUnit<T>;
  /**
   * Lift a plain value into an AgentUnit. Equivalent to `AgentUnit.of(value)`.
   * Useful as the start of a composition chain when you don't need an async
   * computation up front.
   */
  of<T>(value: T): AgentUnit<T>;
  /** Store one-time global configuration (provider, model, apiKey, debug). */
  configure(options: SymplekConfigOptions): void;
  /** List all known providers and their configured status. */
  providers(): ProviderInfo[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CONFIG SINGLETON + INIT PROMISE
// ─────────────────────────────────────────────────────────────────────────────

// _globalConfig is now held in ./globalConfig.ts to avoid circular imports.
// facade.ts writes via mergeGlobalConfig(); providers/auto.ts reads via getGlobalConfig().

// _initPromise slot lives in ./globalConfig.ts; awaitInit() drains it before execution
// and clears the slot after it settles. getInitPromise() and clearInitPromise() are
// also exported from that module for tests that drain the promise directly.
// Keeping the slot there prevents the facade.ts → ai.ts → facade.ts circular import.

/**
 * The supported provider names. Unknown names produce a `PROVIDER_ERROR`.
 *
 * NOTE: "openrouter" is intentionally absent. The OpenAI-compatible adapter does NOT
 * accept a baseURL override in the current Wave-0 implementation, so constructing it
 * with an OpenRouter key would silently route requests to api.openai.com and fail.
 * A dedicated OpenRouter adapter is planned for Wave 3 / Contract 2. Until then,
 * configure({ provider: "openrouter" }) throws a clear PROVIDER_ERROR so callers
 * get an actionable message instead of a silent mis-route.
 */
const SUPPORTED_PROVIDERS: readonly string[] = KNOWN_PROVIDERS.map((p) => p.id);

/**
 * Monotonically increasing counter that advances on every `configure()` call.
 * Each bootstrap receives the generation at the time it was launched; it only
 * commits the provider registration if its generation is still current when the
 * async work completes. This prevents a slower older bootstrap from overwriting
 * a faster newer one when `configure()` is called twice in quick succession.
 */
let _bootstrapGeneration = 0;

/**
 * Bootstrap the provider adapter and register it as the registry default.
 * Called inside `_configure()` via `_initPromise` to keep `configure()` void.
 *
 * Each branch does a true dynamic import() of the adapter module — the SDK is
 * loaded lazily and cached per-module (Contract 2). The factory is async; we
 * await it before registering. The `generation` parameter is compared against
 * `_bootstrapGeneration` after the async work: if a newer `configure()` call
 * has since incremented the counter, this bootstrap is stale and must not
 * overwrite the newer registration.
 */
async function _bootstrapProvider(
  provider: string,
  apiKey: string,
  generation: number,
): Promise<void> {
  const adapter = await createProviderAdapter(provider, apiKey);
  if (generation === _bootstrapGeneration) {
    providerRegistry.register(adapter, true);
  }
}

/**
 * Reset global config + init promise to empty/null. Used in tests.
 * @internal
 */
export function _resetForTesting(): void {
  // Advance the generation counter so any in-flight bootstrap that was
  // launched before this reset holds a generation that can never match a
  // future configure() call. Resetting to 0 creates an ABA window:
  // a pre-reset bootstrap carrying generation N could pass the equality
  // check `generation === _bootstrapGeneration` after a post-reset
  // configure() increments the counter back to N. Advancing makes every
  // past generation permanently unreachable.
  _bootstrapGeneration++;
  resetAll();
}

/**
 * Return the current bootstrap generation counter. FOR TESTING ONLY.
 * @internal
 */
export function _getBootstrapGenerationForTesting(): number {
  return _bootstrapGeneration;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE METHOD IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function _run(
  task: string,
  options?: import("./builder").SymplekOptions<unknown>,
): Promise<TrackedResult<unknown>> {
  return new SymplekBuilder<unknown>(task, options).run();
}

function _agent(config?: AgentConfig): AgentBuilder {
  return createAgent(config);
}

function _configure(options: SymplekConfigOptions): void {
  // Validate provider name synchronously so callers get immediate feedback
  // even though the bootstrap itself is deferred.
  if (
    options.provider !== undefined &&
    !SUPPORTED_PROVIDERS.includes(options.provider)
  ) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      why: `Unknown provider "${options.provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}.`,
      fix: {
        description: `Use one of the supported provider identifiers.`,
        docsUrl: "https://github.com/symplek/symplek#install",
      },
      example: `Symplek.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY })`,
    });
  }

  // Merge options (second call wins per field — contract obligation 4).
  mergeGlobalConfig(options);

  // Apply debug immediately — no async needed.
  if (options.debug !== undefined) {
    traceManager.debug = options.debug;
  }

  // Enqueue provider bootstrap so configure() remains void/synchronous at
  // the call site while ai() awaits completion before first execution.
  // See OQ-1 resolution in wave-0-design.md. Read the merged config after
  // mergeGlobalConfig() so accumulated fields (e.g. apiKey from a prior call)
  // are visible.
  //
  // Generation guard: increment before launching so a slower earlier bootstrap
  // that finishes after this one will discard its result rather than overwriting
  // the newer provider registration.
  const merged = getGlobalConfig();
  // Fall back to the conventional env-var for this provider, so configure({ provider })
  // without an explicit apiKey still enqueues a bootstrap.
  const resolvedKey =
    merged.apiKey ??
    (merged.provider ? getEnvKeyForProvider(merged.provider) : undefined);
  if (merged.provider) {
    // Always increment the generation when a provider is specified, regardless
    // of whether we can resolve a key. This invalidates any pending bootstrap
    // that was started under a prior configuration — if we skip the increment
    // when no key is available, a stale in-flight bootstrap can still register
    // after the newer configuration call supersedes it.
    _bootstrapGeneration++;
    const generation = _bootstrapGeneration;
    if (resolvedKey) {
      setInitPromise(_bootstrapProvider(merged.provider, resolvedKey, generation));
    }
  }
}

function _providers(): ProviderInfo[] {
  const registered = providerRegistry.getAll();
  const result: ProviderInfo[] = registered.map((p) => ({
    id: p.id,
    name: p.name,
    configured: true,
  }));

  const registeredIds = new Set(result.map((p) => p.id));

  for (const kp of KNOWN_PROVIDERS) {
    if (!registeredIds.has(kp.id)) {
      result.push({
        id: kp.id,
        name: kp.name,
        configured: !!process.env[kp.envKey],
      });
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

function _symplekFn<T = string>(
  task: string,
  options?: import("./builder").SymplekOptions<T>,
): SymplekBuilder<T> {
  return new SymplekBuilder<T>(task, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — Symplek callable namespace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Symplek callable namespace.
 *
 * @example
 * ```typescript
 * // Simple AI call
 * const result = await Symplek('Summarise this document');
 *
 * // Bridge to coordination via .coordinate() (from a Symplek(task) call)
 * const consensus = await Symplek('Analyse this clause')
 *   .coordinate()
 *   .consensus([reviewer1, reviewer2, reviewer3])
 *   .run(ctx);
 *
 * // Or bridge directly from the namespace with Symplek.unit / Symplek.of
 * const decision = await Symplek.unit(async () => "Ship the feature")
 *   .consensus([voter1, voter2, voter3])
 *   .run(ctx);
 *
 * const voted = await Symplek.of("Ship the feature")
 *   .consensus([voter1, voter2, voter3])
 *   .run(ctx);
 *
 * // Streaming
 * for await (const chunk of Symplek.stream('task')) { process.stdout.write(chunk); }
 *
 * // Agent builder
 * const result = await Symplek.agent({ model: 'gpt-4o' }).prompt('Summarize').run();
 *
 * // One-time config
 * Symplek.configure({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
 *
 * // Provider list
 * const providers = Symplek.providers();
 * ```
 */
export const Symplek: SymplekFunction = Object.assign(_symplekFn, {
  run: _run,
  stream,
  agent: _agent,
  unit: <T>(computation: AgentComputation<T>) => AgentUnit.from<T>(computation),
  of: <T>(value: T) => AgentUnit.of<T>(value),
  configure: _configure,
  providers: _providers,
}) as unknown as SymplekFunction;

// Re-export agent types for consumers
export { AgentBuilder };
export type { AgentConfig };
