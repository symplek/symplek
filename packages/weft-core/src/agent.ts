/**
 * @module agent - Minimal AgentBuilder for Weft.agent() namespace method
 * @description Thin builder wrapping WeftBuilder for fluent agent-style composition.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @runtime node
 * @surface server:internal
 */

import type { WeftOptions } from "./builder";
import { WeftBuilder } from "./builder";
import type { TrackedResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for an agent created via `Weft.agent()`.
 */
export interface AgentConfig {
  /** Model override for all prompts on this agent. */
  model?: string;
  /** Provider override for this agent. */
  provider?: string;
  /** System prompt prepended to every request. */
  system?: string;
  /** Sampling temperature (0–2). */
  temperature?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returned by `AgentBuilder.prompt()`. Allows calling `.run()` to execute.
 */
export class PromptBuilder {
  private readonly config: AgentConfig;
  private readonly promptText: string;

  constructor(config: AgentConfig, promptText: string) {
    this.config = config;
    this.promptText = promptText;
  }

  /** Execute the prompt against the configured agent. */
  async run(): Promise<TrackedResult<string>> {
    // N50 fix: forward all AgentConfig fields to WeftOptions.
    // Previously only `model` was forwarded; provider, system, and temperature
    // were accepted in AgentConfig but silently dropped here.
    const opts: WeftOptions<string> = {
      model: this.config.model,
      provider: this.config.provider,
      system: this.config.system,
      temperature: this.config.temperature,
    };
    return new WeftBuilder<string>(this.promptText, opts).run();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fluent builder returned by `Weft.agent(config?)`.
 *
 * @example
 * ```typescript
 * const agent = Weft.agent({ model: 'gpt-4o' });
 * const result = await agent.prompt('Summarize this').run();
 * ```
 */
export class AgentBuilder {
  private readonly config: AgentConfig;

  constructor(config: AgentConfig = {}) {
    this.config = config;
  }

  /**
   * Set the prompt text for this invocation.
   * Returns a `PromptBuilder` with a `.run()` method.
   */
  prompt(text: string): PromptBuilder {
    return new PromptBuilder(this.config, text);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new `AgentBuilder` with the given configuration.
 * Used internally by `Weft.agent()`.
 */
export function createAgent(config?: AgentConfig): AgentBuilder {
  return new AgentBuilder(config);
}
