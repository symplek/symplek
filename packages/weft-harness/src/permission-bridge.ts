/**
 * @module PermissionBridge - Tool and path gating for verified plan execution
 * @description Builds a per-session permission bridge from a VerifiedPlan that
 * blocks any tool or file path not declared at verification time. Throws
 * HarnessDeviationError synchronously so the SDK session propagates the error
 * before the tool call reaches the filesystem or network.
 *
 *   - File tools (Read, Glob, Grep, Edit, Write, MultiEdit, NotebookEdit) are
 *     all path-gated against the verified plan's declared `targetPath`s.
 *   - Bash / shell tools are treated as a separate capability: rejected by
 *     default, opt-in via `allowShell: true`. The expectation is that a
 *     planner that needs shell access surfaces that intent at plan-time so
 *     the consensus voters can scrutinise it.
 *   - Paths are normalised (separators, parent-dir refs) before comparison
 *     so simple "../" escapes can't bypass the allow list.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { HarnessDeviationError } from "./errors";
import type { VerifiedPlan } from "./types";

export type PermissionDecision = { behavior: "allow" | "block" };

export interface PermissionBridgeOptions {
  /**
   * Opt-in flag for shell tools (Bash, `bash`, `shell`, `exec`). Off by
   * default. When `false`, any shell-tool call throws `HarnessDeviationError`
   * even if the tool name appears in `requiredTools`. When `true`, shell
   * tools are subject only to the `requiredTools` allow-list with no
   * argument introspection — callers must understand that any approved
   * shell command can do anything.
   */
  allowShell?: boolean;
}

/**
 * Tools that read or write files. Each carries a path-shaped argument under
 * one of the known names; we extract the path argument by name, normalise
 * it, and assert it's in `allowedPaths`.
 */
const FILE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/**
 * Tools that execute shell commands. Treated as a separate capability —
 * opt-in via `allowShell: true`.
 */
const SHELL_TOOLS = new Set(["Bash", "bash", "shell", "exec"]);

/**
 * Possible names for the path-shaped argument on a tool call. Different
 * SDK tools use different field names — Glob uses `pattern`, Edit/Write
 * use `file_path`, etc. We check all of them and use whichever is set.
 */
const PATH_ARG_NAMES = ["file_path", "filePath", "path", "pattern"] as const;

function extractPathArg(args: unknown): string | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  for (const name of PATH_ARG_NAMES) {
    const value = record[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Normalise a path for containment comparison: convert backslashes to
 * forward slashes, split on `/`, drop empty segments and current-dir
 * markers, reject any parent-dir markers (escape attempt).
 */
function normalisePath(p: string): string {
  const segments = p.replace(/\\/g, "/").split("/");
  const cleaned: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      throw new HarnessDeviationError(
        `Path "${p}" contains a parent-directory segment`,
        "<path>",
        "unauthorized_path",
        "<plan>",
      );
    }
    cleaned.push(seg);
  }
  return cleaned.join("/");
}

/**
 * Build a permission bridge for the given verified plan.
 *
 * Returns a `canUseTool` callback suitable for passing to the SDK session.
 * Throws {@link HarnessDeviationError} synchronously on any violation so
 * callers can distinguish deviation from ordinary runtime errors.
 */
export function buildPermissionBridge(
  verified: VerifiedPlan<unknown>,
  options: PermissionBridgeOptions = {},
): (toolName: string, args: unknown) => PermissionDecision {
  const allowedTools = new Set(verified.plan.requiredTools);
  const planId = verified.plan.id;
  const allowShell = options.allowShell ?? false;

  // Normalise the declared paths once at build time so the per-call
  // comparison is a cheap set lookup.
  const allowedPaths = new Set(
    verified.plan.steps
      .filter((s) => s.targetPath !== undefined)
      .map((s) => normalisePath(s.targetPath as string)),
  );

  return (toolName: string, args: unknown): PermissionDecision => {
    if (!allowedTools.has(toolName)) {
      throw new HarnessDeviationError(
        `Tool "${toolName}" is not declared in the verified plan's requiredTools (plan: ${planId})`,
        toolName,
        "unauthorized_tool",
        planId,
      );
    }

    if (SHELL_TOOLS.has(toolName) && !allowShell) {
      throw new HarnessDeviationError(
        `Shell tool "${toolName}" requires explicit allowShell:true; verified plans should declare shell intent at plan-time (plan: ${planId})`,
        toolName,
        "unauthorized_tool",
        planId,
      );
    }

    if (FILE_TOOLS.has(toolName)) {
      const rawPath = extractPathArg(args);
      if (rawPath === undefined) {
        // Tool was approved at the requiredTools level but supplied no path
        // argument — that's unusual for file tools, but harmless: nothing
        // to gate. Allow.
        return { behavior: "allow" };
      }
      let normalised: string;
      try {
        normalised = normalisePath(rawPath);
      } catch (err) {
        if (err instanceof HarnessDeviationError) {
          // Rebuild with concrete tool + plan context.
          throw new HarnessDeviationError(
            `Path "${rawPath}" accessed via "${toolName}" contains a parent-directory segment (plan: ${planId})`,
            toolName,
            "unauthorized_path",
            planId,
          );
        }
        throw err;
      }
      if (!allowedPaths.has(normalised)) {
        throw new HarnessDeviationError(
          `Path "${rawPath}" accessed via "${toolName}" is not in the verified plan's target paths (plan: ${planId})`,
          toolName,
          "unauthorized_path",
          planId,
        );
      }
    }

    return { behavior: "allow" };
  };
}
