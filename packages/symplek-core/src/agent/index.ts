/**
 * @module agent - Public tool and loop primitives for @symplek/core/agent subpath.
 * @description Exports the tool definition API and loop control primitives.
 *   These are published on the @symplek/core/agent subpath to keep the root
 *   barrel clean and to signal that these are agent-execution concerns,
 *   not core composition primitives.
 *
 * @since 1.0.0-beta.1 — CR-402: tool loop surfaced
 *
 * @example
 * ```typescript
 * import { tool, stopWhen, LoopOptions } from "@symplek/core/agent";
 * ```
 */

// ─── Tool definition API ──────────────────────────────────────────────────────
export { tool } from "./tool";
export type { Tool, ToolApprovalPayload } from "./tool";

// ─── Loop control primitives ──────────────────────────────────────────────────
export {
  stopWhen,
  DEFAULT_LOOP_OPTIONS,
} from "../loop";
export type { LoopOptions, StepInfo, StepModifications } from "../loop";

// ─── Loop operator options (from AgentUnit operator, not root barrel) ─────────
export type { LoopOperatorOptions } from "../AgentUnit/operators/loop";
export type { LoopExecuteOptions } from "./executor";

// ─── Approval types ───────────────────────────────────────────────────────────
export {
  ToolApprovalRequiredError,
  createToolApprovalComputation,
  createToolApprovalGateComputation,
} from "../interview/computations";
export type { ToolApprovalPending } from "../interview/computations";
