/**
 * Utility functions for Weft core.
 *
 * 📝 BUILD[Weft-algebra-level3]: Type-safe unwrapping of TrackedResult
 * @module
 */

import type { TrackedResult } from "./types";
import { TRACKED_MARKER } from "./types";

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
 * unwrapTracked({ value: "hello", [TRACKED_MARKER]: true, ... }) // => "hello"
 * unwrapTracked("hello") // => "hello"
 * ```
 */
export function unwrapTracked<T>(result: TrackedResult<T> | T): T {
  if (
    result !== null &&
    result !== undefined &&
    typeof result === "object" &&
    TRACKED_MARKER in (result as Record<symbol, unknown>)
  ) {
    return (result as TrackedResult<T>).value;
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
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    TRACKED_MARKER in (value as Record<symbol, unknown>)
  );
}
