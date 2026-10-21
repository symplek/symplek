/**
 * @module PermissionBridge - Tool and path gating for verified plan execution
 * @description Builds a per-session permission bridge from a VerifiedPlan that
 * blocks any tool or file path not declared at verification time. Throws
 * HarnessDeviationError synchronously so the SDK session propagates the error
 * before the tool call reaches the filesystem or network.
 *
 *   - File tools (Read, Glob, Grep, Edit, Write, MultiEdit, NotebookEdit, and
 *     MCP file-write aliases) are all path-gated against the verified plan's
 *     declared `targetPath`s. Every path-shaped argument is checked — not only
 *     the first one — so a secondary `glob` or `pattern` field cannot escape.
 *   - Absolute paths (Unix leading `/`, Windows drive `C:\`, or repeated
 *     leading slashes) are rejected even when the relative remainder matches
 *     an allowed path. An absolute path was never declared at plan time.
 *   - Bash / shell tools are treated as a separate capability: rejected by
 *     default, opt-in via `allowShell: true`. Shell aliases (`sh`, `PowerShell`,
 *     `local_shell`, etc.) are in the same set and follow the same rule.
 *   - GUI automation and agent-spawning tools (`computer`, `Task`) are treated
 *     as shell-class: rejected unless `allowShell: true`.
 *   - Paths are normalised (separators, parent-dir refs) before comparison
 *     so simple "../" escapes can't bypass the allow list.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { HarnessDeviationError } from "./errors.js";
import type { VerifiedPlan } from "./types.js";

export type PermissionDecision = { behavior: "allow" | "block" };

export interface PermissionBridgeOptions {
  /**
   * Opt-in flag for shell tools and their aliases. Off by default. When
   * `false`, any tool whose name appears in `SHELL_TOOLS` throws
   * `HarnessDeviationError` even if listed in `requiredTools`. When `true`,
   * shell tools are subject only to the `requiredTools` allow-list — no
   * argument introspection applies. Callers must understand that any approved
   * shell command can do anything.
   */
  allowShell?: boolean;
}

/**
 * Tools that read or write files. Each carries at least one path-shaped
 * argument; every path argument is normalised and checked against
 * `allowedPaths`. Includes MCP aliases for common file-write operations.
 */
const FILE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  // MCP / editor aliases that mutate files — same path gate as Write/Edit.
  "str_replace_editor",
  "apply_patch",
  "mcp__filesystem__write_file",
  "mcp__filesystem__read_file",
  "mcp__filesystem__create_directory",
]);

/**
 * Tools that execute shell commands or spawn sub-agents / GUI automation.
 * Rejected unless `allowShell: true`. Includes all known aliases.
 */
const SHELL_TOOLS = new Set([
  // Core shell invokers
  "Bash",
  "bash",
  "shell",
  "exec",
  // POSIX / Windows aliases
  "sh",
  "PowerShell",
  "pwsh",
  "cmd",
  // MCP shell bridges
  "local_shell",
  "mcp__shell__run",
  "mcp__bash__bash",
  // Agent spawning and GUI automation — full OS access; treat as shell-class.
  "computer",
  "Task",
]);

/**
 * All known path-argument field names across SDK tool call schemas.
 * Every field in this list is extracted and path-checked when present.
 * Having multiple entries per call (e.g. `path` + `pattern` on Glob) is
 * intentional — all must fall within the declared allow-list.
 */
const PATH_ARG_NAMES = [
  "file_path",
  "filePath",
  "path",
  "pattern",
  "glob",
  "notebook_path",
  "notebookPath",
  "source_path",
  "target_path",
] as const;

/**
 * Extract every path-shaped argument from a tool call's args object.
 * Returns all non-empty string values found under the known path field names
 * so that a secondary `pattern` or `glob` field cannot slip through unchecked.
 */
function extractAllPathArgs(args: unknown): string[] {
  if (args === null || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const paths: string[] = [];
  for (const name of PATH_ARG_NAMES) {
    const value = record[name];
    if (typeof value === "string" && value.length > 0) {
      paths.push(value);
    }
  }
  return paths;
}

/**
 * Return true when a raw path string looks like an absolute path.
 * Matches Unix `/...`, Windows `C:\...` or `C:/...`, and repeated
 * leading slashes `///...`.
 */
function isAbsolutePath(raw: string): boolean {
  // Convert backslashes to forward slashes for uniform testing.
  const normalized = raw.replace(/\\/g, "/");
  // Unix absolute: starts with /
  if (normalized.startsWith("/")) return true;
  // Windows drive letter: C:/ or C:\
  if (/^[A-Za-z]:/.test(normalized)) return true;
  return false;
}

/**
 * Normalise a relative path for containment comparison: convert backslashes
 * to forward slashes, split on `/`, drop empty segments and current-dir
 * markers, reject any parent-dir markers (escape attempt).
 *
 * Callers must check `isAbsolutePath` before calling this so that absolute
 * paths are rejected before normalisation strips the evidence.
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
    // ── Step 1: requiredTools allow-list ─────────────────────────────────────
    if (!allowedTools.has(toolName)) {
      throw new HarnessDeviationError(
        `Tool "${toolName}" is not declared in the verified plan's requiredTools (plan: ${planId})`,
        toolName,
        "unauthorized_tool",
        planId,
      );
    }

    // ── Step 2: Shell gate ────────────────────────────────────────────────────
    if (SHELL_TOOLS.has(toolName)) {
      if (!allowShell) {
        throw new HarnessDeviationError(
          `Shell/automation tool "${toolName}" requires explicit allowShell:true; ` +
            `verified plans should declare shell intent at plan-time (plan: ${planId})`,
          toolName,
          "unauthorized_tool",
          planId,
        );
      }
      // allowShell:true — shell tools bypass path introspection.
      return { behavior: "allow" };
    }

    // ── Step 3: File-tool path gate ───────────────────────────────────────────
    if (FILE_TOOLS.has(toolName)) {
      const rawPaths = extractAllPathArgs(args);

      if (rawPaths.length === 0) {
        // Fail-closed: a file tool with no recognisable path argument cannot
        // be validated, so it is denied.
        throw new HarnessDeviationError(
          `File tool "${toolName}" invoked with no recognisable path argument; path gate cannot apply (plan: ${planId})`,
          toolName,
          "unauthorized_path",
          planId,
        );
      }

      for (const rawPath of rawPaths) {
        // Absolute paths were never declared — deny before normalisation.
        if (isAbsolutePath(rawPath)) {
          throw new HarnessDeviationError(
            `Absolute path "${rawPath}" accessed via "${toolName}" is not permitted; ` +
              `only relative paths declared in the verified plan are allowed (plan: ${planId})`,
            toolName,
            "unauthorized_path",
            planId,
          );
        }

        let normalised: string;
        try {
          normalised = normalisePath(rawPath);
        } catch (err) {
          if (err instanceof HarnessDeviationError) {
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
    }

    // ── Step 4: anything else is denied ──────────────────────────────────────
    // A tool this gate does not recognise could read, write, fetch or run
    // anything. Being listed in `requiredTools` says the plan wants it, not
    // what it touches, so the gate has nothing to check its arguments against.
    // A gate that cannot check must refuse. To use such a tool, teach the gate
    // what kind of tool it is (FILE_TOOLS or SHELL_TOOLS above).
    throw new HarnessDeviationError(
      `Tool "${toolName}" is not one this gate knows how to check, so it is refused (plan: ${planId})`,
      toolName,
      "unauthorized_tool",
      planId,
    );
  };
}
