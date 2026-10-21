/**
 * @module AgentUnit/operators/runStandalone
 * @description AgentUnit standalone execution — runs without a pre-created context.
 *   Convenience for tests and REPL usage; prefer .run(ctx) in production.
 * @runtime node
 * @surface public
 */

import { createContext } from "../../context";
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
