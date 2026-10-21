/**
 * Utility functions for Symplek core.
 *
 * 📝 BUILD[Symplek-algebra-level3]: Type-safe unwrapping of TrackedResult
 * @module
 */

import type { TrackedResult } from "./types";
import { isTrackedResult, unwrapTrackedResult } from "./trust";

/**
 * Type-safe extraction of raw value from a TrackedResult or pass-through.
 *
 * Eliminates `as any` casts when consuming AgentUnit output in Convex actions.
 * Accepts either a TrackedResult<T> (zero-trust mode) or a raw T (legacy mode)
 * and always returns the unwrapped T.
 *
 * @param result - TrackedResult<T> or raw T value
 * @returns The unwrapped value of type T
 *
 * @example
 * ```typescript
 * // In Convex actions — no more `as any`:
 * const raw = unwrapTracked(agentResult);
 * // raw is properly typed as T
 *
 * // Works with both modes:
 * unwrapTracked(createTrackedResult("hello")) // => "hello"
 * unwrapTracked("hello") // => "hello"
 * ```
 */
export function unwrapTracked<T>(result: TrackedResult<T> | T): T {
  if (isTrackedResult(result)) {
    return unwrapTrackedResult(result);
  }
  return result as T;
}

/**
 * Type guard to check if a value is a TrackedResult.
 *
 * @param value - Any value to check
 * @returns true if the value is a legitimate TrackedResult
 *
 * @example
 * ```typescript
 * if (isTracked(result)) {
 *   console.log(result.confidence);
 * }
 * ```
 */
export function isTracked<T>(
  value: TrackedResult<T> | T,
): value is TrackedResult<T> {
  return isTrackedResult(value);
}
