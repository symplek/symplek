/**
 * @module PermissionBridge - Tool and path gating for verified plan execution
 * @description Builds a per-session permission bridge from a VerifiedPlan that
 * blocks any tool or file path not declared at verification time. Throws
 * HarnessDeviationError synchronously so the SDK session propagates the error
 * before the tool call reaches the filesystem or network.
 *
 *   - File tools (Read, Glob, Grep, Edit, Write, MultiEdit, NotebookEdit, and
 *     MCP file-write aliases) are path-gated against the verified plan's
 *     declared `targetPath`s. Every path-shaped argument is checked, not only
 *     the first one.
 *   - The search tools (Grep, Glob) carry two kinds of argument that are not
 *     paths. A glob that chooses files under the search root has to be a
 *     plain glob: names that may hold `*` and `?`, single dots between names,
 *     and `/` between segments. A plain glob cannot spell a path outside the
 *     search root; what the engine does with wildcards and symbolic links is
 *     left to the engine (see `PLAIN_GLOB`). A regular expression matched
 *     against file contents (Grep's `pattern`) is not inspected: it cannot
 *     change where the search looks.
 *   - A search with no root (`path`) is refused: it would be a search of
 *     everything.
 *   - Absolute paths (Unix leading `/`, Windows drive `C:\`, or repeated
 *     leading slashes) are rejected in requested paths. Declared `targetPath`s
 *     that are absolute are rejected at bridge-build time so a plan can never
 *     authorise a different file from the one written in it.
 *   - Bash / shell tools are a separate capability: rejected by default,
 *     opt-in via `allowShell: true`. Shell aliases (`sh`, `PowerShell`,
 *     `local_shell`, etc.) follow the same rule.
 *   - Web tools (WebSearch, WebFetch) are passed through after the
 *     `requiredTools` allow-list check with no further argument inspection.
 *     The bridge does NOT gate network access; listing these tools in
 *     `requiredTools` is the only control applied to them.
 *   - Any tool the gate does not recognise is refused, even if listed in
 *     `requiredTools`. To use such a tool, add it to one of the known
 *     categories (FILE_TOOLS, SHELL_TOOLS, or WEB_TOOLS).
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
 * argument (see `PATH_ARG_NAMES`), and every one present is checked. Includes
 * MCP aliases for common file-write operations.
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
 * Network / search tools. Allowed after the `requiredTools` check with no
 * further argument inspection. The bridge does NOT gate network access; if a
 * caller needs to restrict URLs or queries, that must be handled outside the
 * bridge.
 */
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

/**
 * Argument names that carry a file or folder path. Every one present on a
 * file-tool call is checked against the plan's declared paths, so a second
 * path-shaped argument cannot slip through unchecked.
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
 * The search tools carry arguments that share a name with a path argument but
 * are not one, so the path check alone would refuse every ordinary search.
 *
 *   - `globs` choose files under the search root (`path`). They cannot be
 *     matched against declared paths, so they have to be plain globs (see
 *     `PLAIN_GLOB` for the form, and for what it does and does not rule out).
 *   - `contents` are regular expressions matched against file contents. They
 *     cannot change where a search looks, and are not inspected.
 *
 * The search root is still a path: it must be declared, and a search with no
 * root is refused like any other file-tool call with no path.
 */
const SEARCH_ARGS: Readonly<
  Partial<
    Record<string, { globs: readonly string[]; contents: readonly string[] }>
  >
> = {
  Glob: { globs: ["pattern"], contents: [] },
  Grep: { globs: ["glob"], contents: ["pattern"] },
};

/** The non-empty string arguments a call carries under the given names. */
function stringArgs(
  args: unknown,
  names: readonly string[],
): Array<{ name: string; value: string }> {
  if (args === null || typeof args !== "object") return [];
  const record = args as Record<string, unknown>;
  const found: Array<{ name: string; value: string }> = [];
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.length > 0) {
      found.push({ name, value });
    }
  }
  return found;
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
 * Check a single path argument against the gate constraints.
 * Throws HarnessDeviationError if the path is absolute, contains a parent-dir
 * segment, or is not in `allowedPaths`.
 */
function assertPathAllowed(
  rawPath: string,
  toolName: string,
  allowedPaths: Set<string>,
  planId: string,
): void {
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
  } catch {
    throw new HarnessDeviationError(
      `Path "${rawPath}" accessed via "${toolName}" contains a parent-directory segment (plan: ${planId})`,
      toolName,
      "unauthorized_path",
      planId,
    );
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

/**
 * The only globs the gate lets through: path segments joined by single
 * slashes, each segment one or more names joined by single dots, each name
 * made of ASCII letters, digits, `_`, `*` and `?`, with `-` allowed after the
 * first character. `src/lib/*.test.ts` and `*.d.ts` are plain globs, and so
 * is a path with `**` segments in it.
 *
 * That is much less than glob syntax, on purpose. The text of a glob leaves
 * its search root by turning into an absolute path or a path with a `..`
 * segment, and glob syntax has many ways to spell either without writing it
 * out (braces, escapes, classes, tildes, extended groups). A list of forbidden
 * spellings is never finished, so this is a list of what is allowed, and
 * nothing in it can expand: there are no braces, brackets, backslashes,
 * tildes, dollar signs, colons, parentheses or spaces in the language at all.
 *
 * What follows from the shape alone: a segment is never empty, so the glob
 * cannot start with `/`; and a dot always has a name on both sides, so no
 * segment is `.` or `..`, none starts with a dot, and `..` cannot appear.
 *
 * Two things are left to the engine, and a check on the text cannot enforce
 * either. The first is matching `*` and `?` against real names: this assumes
 * a wildcard never matches the directory entries `.` and `..` in a segment
 * that does not itself start with a dot, which is how glob engines behave
 * unless set up otherwise. The second is symbolic links: a link under the
 * root can point outside it, and some engines follow links by default. An
 * adapter that wires in an engine has to check the paths it gets back where
 * either matters.
 *
 * The cost: `*.{ts,tsx}` takes two searches, and hidden files (`.env*`) and
 * names outside ASCII cannot be selected by glob.
 */
const GLOB_NAME = "[A-Za-z0-9_*?][A-Za-z0-9_*?-]*";
const GLOB_SEGMENT = `${GLOB_NAME}(?:\\.${GLOB_NAME})*`;
const PLAIN_GLOB = new RegExp(`^${GLOB_SEGMENT}(?:/${GLOB_SEGMENT})*$`);

/**
 * Refuse a glob argument unless it is a plain glob, as defined above. The glob
 * is not required to be a declared path.
 */
function assertGlobStaysInside(
  glob: string,
  argName: string,
  toolName: string,
  planId: string,
): void {
  if (!PLAIN_GLOB.test(glob)) {
    throw new HarnessDeviationError(
      `Glob argument "${argName}" on "${toolName}" is not a plain glob ("${glob}"). ` +
        "Allowed: names made of ASCII letters, digits, `_`, `*` and `?` (with `-` allowed after a name's first character), " +
        "single dots between names, and `/` between segments, " +
        `so that a search can only select files under its declared root (plan: ${planId})`,
      toolName,
      "unauthorized_path",
      planId,
    );
  }
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
  // A declared absolute targetPath cannot be represented as a relative
  // path; reject it here so a plan never silently authorises a different
  // file from the one written in the plan.
  const allowedPaths = new Set(
    verified.plan.steps
      .filter((s) => s.targetPath !== undefined)
      .map((s) => {
        const tp = s.targetPath as string;
        if (isAbsolutePath(tp)) {
          throw new HarnessDeviationError(
            `Plan declares an absolute targetPath "${tp}" — only relative paths are ` +
              `permitted in verified plans (plan: ${planId})`,
            "<plan>",
            "unauthorized_path",
            planId,
          );
        }
        return normalisePath(tp);
      }),
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
      const search = SEARCH_ARGS[toolName];
      const notPaths = search ? [...search.globs, ...search.contents] : [];
      const paths = stringArgs(
        args,
        PATH_ARG_NAMES.filter((name) => !notPaths.includes(name)),
      );

      if (paths.length === 0) {
        // Fail-closed: a file tool with no recognisable path argument cannot
        // be validated, so it is denied. For a search tool this is a search
        // with no root, which would be a search of everything.
        throw new HarnessDeviationError(
          `File tool "${toolName}" invoked with no recognisable path argument; path gate cannot apply (plan: ${planId})`,
          toolName,
          "unauthorized_path",
          planId,
        );
      }

      for (const { value } of paths) {
        assertPathAllowed(value, toolName, allowedPaths, planId);
      }
      for (const { name, value } of stringArgs(args, search?.globs ?? [])) {
        assertGlobStaysInside(value, name, toolName, planId);
      }

      return { behavior: "allow" };
    }

    // ── Step 4: Web tools — allowed after requiredTools check (Step 1) ───────
    // The bridge does not gate network access. WebSearch and WebFetch are
    // passed through here; the only control is that they must be listed in
    // `requiredTools`, which was verified in Step 1.
    if (WEB_TOOLS.has(toolName)) {
      return { behavior: "allow" };
    }

    // ── Step 5: anything else is denied ──────────────────────────────────────
    // A tool this gate does not recognise could read, write, fetch or run
    // anything. Being listed in `requiredTools` says the plan wants it, not
    // what it touches, so the gate has nothing to check its arguments against.
    // A gate that cannot check must refuse. To use such a tool, add it to
    // FILE_TOOLS, SHELL_TOOLS, or WEB_TOOLS above.
    throw new HarnessDeviationError(
      `Tool "${toolName}" is not one this gate knows how to check, so it is refused (plan: ${planId})`,
      toolName,
      "unauthorized_tool",
      planId,
    );
  };
}
