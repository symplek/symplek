/**
 * @fileoverview Context creation utilities for weft-core
 * @description Standalone context creation (no Convex dependency)
 * @module weft-core/context
 * @since 1.0.0-beta.1
 *
 * 📝 BUILD[05.04]: Context utilities for standalone package
 */

import type { AgentContext } from "./types";

/**
 * Creates a minimal AgentContext for standalone use.
 *
 * @param options - Optional context options
 * @returns A new AgentContext
 *
 * @example
 * ```typescript
 * const ctx = createContext({ signal: abortController.signal });
 * const result = await unit.run(ctx);
 * ```
 */
export function createContext(options?: {
  signal?: AbortSignal;
  extensions?: Record<string, unknown>;
}): AgentContext {
  return {
    timestamp: Date.now(),
    signal: options?.signal,
    extensions: options?.extensions ?? {},
  };
}
