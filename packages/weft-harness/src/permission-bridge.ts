/**
 * @module PermissionBridge - Tool and path gating for verified plan execution
 * @description Builds a per-session permission bridge from a VerifiedPlan that
 * blocks any tool or file path not declared at verification time. Throws
 * HarnessDeviationError synchronously so the SDK session propagates the error
 * before the tool call reaches the filesystem or network.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { HarnessDeviationError } from "./errors";
import type { VerifiedPlan } from "./types";

export type PermissionDecision = { behavior: "allow" | "block" };

/** Tool names that carry a `file_path` argument subject to path checking. */
const PATH_TOOLS = new Set(["Edit", "Write"]);

/**
 * Build a permission bridge for the given verified plan.
 *
 * Returns a `canUseTool` callback suitable for passing to the SDK session.
 * Throws {@link HarnessDeviationError} synchronously on any violation so callers
 * can distinguish deviation from ordinary runtime errors.
 *
 * @param verified - The consensus-approved plan defining allowed tools and paths.
 * @returns A callback `(toolName, args) => PermissionDecision`.
 */
export function buildPermissionBridge(
  verified: VerifiedPlan<unknown>,
): (toolName: string, args: unknown) => PermissionDecision {
  const allowedTools = new Set(verified.plan.requiredTools);

  // Collect every declared target path across all steps (steps without
  // targetPath are not file-producing and skip path enforcement).
  const allowedPaths = new Set(
    verified.plan.steps
      .filter((s) => s.targetPath !== undefined)
      .map((s) => s.targetPath as string),
  );

  return (toolName: string, args: unknown): PermissionDecision => {
    if (!allowedTools.has(toolName)) {
      throw new HarnessDeviationError(
        `Tool "${toolName}" is not declared in the verified plan's requiredTools (plan: ${verified.plan.id})`,
        toolName,
        "unauthorized_tool",
        verified.plan.id,
      );
    }

    if (PATH_TOOLS.has(toolName)) {
      const filePath = (args as { file_path?: string } | null)?.file_path;
      if (filePath !== undefined && !allowedPaths.has(filePath)) {
        throw new HarnessDeviationError(
          `Path "${filePath}" accessed via "${toolName}" is not in the verified plan's target paths (plan: ${verified.plan.id})`,
          toolName,
          "unauthorized_path",
          verified.plan.id,
        );
      }
    }

    return { behavior: "allow" };
  };
}
