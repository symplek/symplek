/**
 * @module facade - Server-side callable namespace for weft-core
 * @description Real AI execution facade — SERVER-ONLY (Node.js / Convex Actions).
 *   Exports `Weft` as a callable namespace with `.run()`, `.stream()`, `.agent()`,
 *   `.configure()`, and `.providers()` methods, while preserving the direct
 *   `Weft(task)` call signature returning `WeftBuilder<T>`.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @blast_radius MEDIUM
 * @status stable
 * @runtime node
 * @surface server:public
 */

import type { z } from "zod";
import type { AgentConfig } from "./agent";
import { AgentBuilder, createAgent } from "./agent";
import { WeftBuilder } from "./builder";
import { providerRegistry } from "./providers/registry";
import type { StreamOptions } from "./streaming";
import { stream } from "./streaming";
import type { TrackedResult } from "./types";

export type { WeftOptions } from "./builder";
// Re-export for external consumers who previously imported from "./facade"
export { WeftBuilder } from "./builder";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES — Namespace additions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-time global configuration for the Weft facade.
 */
export interface WeftConfigOptions {
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
 * The Weft callable namespace type.
 * Supports direct call (returns WeftBuilder) AND named methods.
 */
export interface WeftFunction {
  /** Direct call returning a WeftBuilder<string>. */
  (task: string): WeftBuilder<string>;
  /** Direct call with schema returning a WeftBuilder<T>. */
  <T>(
    task: string,
    options: import("./builder").WeftOptions<T> & { schema: z.ZodType<T> },
  ): WeftBuilder<T>;
  /** Direct call with options but no schema (model/timeout/etc overrides). */
  <T = string>(
    task: string,
    options: import("./builder").WeftOptions<T>,
  ): WeftBuilder<T>;
  /** Explicitly run a task. Equivalent to awaiting the direct call. */
  run(
    task: string,
    options?: import("./builder").WeftOptions<unknown>,
  ): Promise<TrackedResult<unknown>>;
  /** Stream incremental text chunks from the AI provider. */
  stream(task: string, options?: StreamOptions): AsyncGenerator<string>;
  /** Create a fluent AgentBuilder with per-agent configuration. */
  agent(config?: AgentConfig): AgentBuilder;
  /** Store one-time global configuration (provider, model, apiKey, debug). */
  configure(options: WeftConfigOptions): void;
  /** List all known providers and their configured status. */
  providers(): ProviderInfo[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL CONFIG SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let _globalConfig: WeftConfigOptions = {};

// ─────────────────────────────────────────────────────────────────────────────
// NAMESPACE METHOD IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function _run(
  task: string,
  options?: import("./builder").WeftOptions<unknown>,
): Promise<TrackedResult<unknown>> {
  return new WeftBuilder<unknown>(task, options).run();
}

function _agent(config?: AgentConfig): AgentBuilder {
  return createAgent(config);
}

function _configure(options: WeftConfigOptions): void {
  _globalConfig = { ..._globalConfig, ...options };
}

const KNOWN_PROVIDERS: ReadonlyArray<{
  id: string;
  name: string;
  envKey: string;
}> = [
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  { id: "google", name: "Google", envKey: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY" },
];

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

function _weftFn<T = string>(
  task: string,
  options?: import("./builder").WeftOptions<T>,
): WeftBuilder<T> {
  return new WeftBuilder<T>(task, options);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — Weft callable namespace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Weft callable namespace.
 *
 * @example
 * ```typescript
 * // Direct call
 * const result = await Weft('task');
 *
 * // Explicit run
 * const result = await Weft.run('task');
 *
 * // Streaming
 * for await (const chunk of Weft.stream('task')) { process.stdout.write(chunk); }
 *
 * // Agent builder
 * const result = await Weft.agent({ model: 'gpt-4o' }).prompt('Summarize').run();
 *
 * // One-time config
 * Weft.configure({ provider: 'openai', model: 'gpt-4o' });
 *
 * // Provider list
 * const providers = Weft.providers();
 * ```
 */
export const Weft: WeftFunction = Object.assign(_weftFn, {
  run: _run,
  stream,
  agent: _agent,
  configure: _configure,
  providers: _providers,
}) as unknown as WeftFunction;

// Re-export agent types for consumers
export { AgentBuilder };
export type { AgentConfig };
