/**
 * @module AgentUnit/operators/runStandalone
 * @description AgentUnit standalone execution — runs without a pre-created context.
 *   Convenience for tests and REPL usage; prefer .run(ctx) in production.
 *
 *   Also provides `runWithStore()` for durable execution with a pre-wired
 *   `DurableStoreOptions` (CR-403).
 * @runtime node
 * @surface public
 */

import { createContext } from "../../context";
import type { DurableStoreOptions } from "../../store/backend";
import type { RunOptionsWithTrust, TrackedResult } from "../../types";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.runStandalone = function <T>(
  this: AgentUnit<T>,
  options?: RunOptionsWithTrust,
): Promise<TrackedResult<T> | T> {
  const ctx = createContext();
  return (
    this as unknown as {
      run: (
        ctx: ReturnType<typeof createContext>,
        opts?: RunOptionsWithTrust,
      ) => Promise<TrackedResult<T> | T>;
    }
  ).run(ctx, options);
};

/**
 * Run this AgentUnit with a durable store wired for at-most-once execution.
 *
 * Convenience method for the common case of running a unit with a durable
 * idempotency store. Equivalent to:
 * ```typescript
 * unit.run(createContext(), {
 *   idempotency: { key, strategy: "return-cached", store: store.idempotency },
 * });
 * ```
 *
 * @param key   Stable idempotency key for this run.
 * @param store Durable store options from {@link createDurableStore}.
 */
AgentUnit.prototype.runWithStore = function <T>(
  this: AgentUnit<T>,
  key: string,
  store: DurableStoreOptions,
): Promise<TrackedResult<T>> {
  const ctx = createContext();
  return (
    this as unknown as {
      run: (
        ctx: ReturnType<typeof createContext>,
        opts: RunOptionsWithTrust,
      ) => Promise<TrackedResult<T>>;
    }
  ).run(ctx, {
    idempotency: {
      key,
      strategy: "return-cached",
      store: store.idempotency,
    },
  });
};

// ─── Type augmentation ───────────────────────────────────────────────────────

declare module "../AgentUnit" {
  interface AgentUnit<T> {
    runStandalone(options?: RunOptionsWithTrust): Promise<TrackedResult<T> | T>;
    runWithStore(key: string, store: DurableStoreOptions): Promise<TrackedResult<T>>;
  }
}
