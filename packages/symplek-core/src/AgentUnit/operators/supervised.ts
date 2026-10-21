/**
 * @module AgentUnit/operators/supervised
 * @description AgentUnit supervised operator extension (.supervised()).
 *   Adds human-in-the-loop oversight to any agent composition. When the
 *   predicate fires on the output, the value is held and a review function
 *   is called before downstream computation receives the value.
 * @rules @.cursor/rules/frameworks/206-symplek-framework.mdc
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

// ─── PUBLIC TYPES ──────────────────────────────────────────────────────────────

/**
 * The decision a reviewer returns after inspecting a held value.
 */
export type SupervisedDecision<T> =
  | { action: "accept" }
  | { action: "accept"; value: T }
  | { action: "reject"; fallback: T }
  | { action: "reject" };

/**
 * Options controlling timeout and fallback behaviour of the supervised operator.
 */
export interface SupervisedOptions<T = unknown> {
  /**
   * Maximum milliseconds to wait for the review function to resolve.
   * If the review does not complete within this window the `timeoutAction` policy fires.
   */
  timeoutMs?: number;
  /**
   * What to do when `timeoutMs` elapses before the review completes.
   * - `"accept"` — auto-accept the original value (safe default for read-only inspections)
   * - `"reject"` — throw a `SupervisedTimeoutError` (default when `timeoutMs` is set)
   * - `"fallback"` — return `fallbackValue`; requires `fallbackValue` to be set
   */
  timeoutAction?: "accept" | "reject" | "fallback";
  /**
   * A static fallback value used when:
   * - The reviewer returns `{ action: "reject" }` with no `fallback` field, OR
   * - `timeoutAction === "fallback"` and the review timed out.
   */
  fallbackValue?: T;
}

// ─── ERRORS ────────────────────────────────────────────────────────────────────

/**
 * Thrown when a reviewer returns `{ action: "reject" }` with no fallback
 * and `options.fallbackValue` is not set.
 */
export class SupervisedRejectionError extends Error {
  constructor(
    message = "Supervised review rejected the value with no fallback",
  ) {
    super(message);
    this.name = "SupervisedRejectionError";
  }
}

/**
 * Thrown when the review function does not complete within `options.timeoutMs`
 * and `options.timeoutAction === "reject"` (or `timeoutAction` is unset).
 */
export class SupervisedTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Supervised review timed out after ${timeoutMs}ms`);
    this.name = "SupervisedTimeoutError";
  }
}

// ─── MODULE AUGMENTATION ───────────────────────────────────────────────────────

// ─── PROTOTYPE AUGMENTATION ────────────────────────────────────────────────────

AgentUnit.prototype.supervised = function <T>(
  this: AgentUnit<T>,
  predicateFn: (value: T) => boolean,
  reviewFn: (value: T) => Promise<SupervisedDecision<T>>,
  options: SupervisedOptions<T> = {},
): AgentUnit<T> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();

  return AgentUnit._make<T>(
    async (ctx) => {
      const value = await selfComp(ctx);

      // Predicate-skip path: predicate returns false → pass value through unchanged
      if (!predicateFn(value)) {
        return value;
      }

      // Build the review promise
      const reviewPromise = reviewFn(value);

      // Resolve the review, optionally racing against a timeout
      let decision: SupervisedDecision<T>;

      if (options.timeoutMs !== undefined) {
        const timeoutMs = options.timeoutMs;
        const timeoutAction = options.timeoutAction ?? "reject";

        let timerId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new SupervisedTimeoutError(timeoutMs)),
            timeoutMs,
          );
        });
        // Attach a no-op catch so Node/Vitest never sees an "unhandled rejection"
        // from timeoutPromise regardless of which branch of Promise.race wins.
        timeoutPromise.catch(() => {});

        try {
          decision = await Promise.race([reviewPromise, timeoutPromise]);
          clearTimeout(timerId!);
        } catch (err) {
          clearTimeout(timerId!);
          if (err instanceof SupervisedTimeoutError) {
            if (timeoutAction === "accept") {
              return value;
            }
            if (
              timeoutAction === "fallback" &&
              options.fallbackValue !== undefined
            ) {
              return options.fallbackValue;
            }
            // timeoutAction === "reject" or fallback without a value
            throw err;
          }
          throw err;
        }
      } else {
        decision = await reviewPromise;
      }

      // Process decision
      if (decision.action === "accept") {
        // Accept with optional reviewer-provided value
        return "value" in decision
          ? (decision as { action: "accept"; value: T }).value
          : value;
      }

      // action === "reject"
      if ("fallback" in decision) {
        return (decision as { action: "reject"; fallback: T }).fallback;
      }
      // No fallback in decision — check options.fallbackValue
      if (options.fallbackValue !== undefined) {
        return options.fallbackValue;
      }
      throw new SupervisedRejectionError();
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "supervised"],
      createdAt: Date.now(),
    },
  );
};
