/**
 * @module permission-bridge.test — Gate hardening tests (H5, H6, H7, H8)
 * @description Each test here gates a confirmed bypass or gap in buildPermissionBridge.
 *   H5: Absolute paths (leading slash, backslash, repeated slashes) must be denied.
 *   H6: Every path-shaped argument on a tool call must be checked, not just the first.
 *   H7: Shell-tool aliases not in the original SHELL_TOOLS set must be denied.
 *   H8: execute() must accept allowShell in ExecuteOptions and pass it to the bridge.
 * A failure means a fix regressed, not that the test is wrong.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";
import { createContext } from "weft-core";
import { HarnessDeviationError } from "../errors";
import { execute } from "../operators/execute";
import type { SdkSession } from "../operators/execute";
import { buildPermissionBridge } from "../permission-bridge";
import type { VerifiedPlan } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ctx = createContext();

function makeVerifiedPlanWithPaths(
  allowedPaths: string[],
  tools: string[] = ["Read", "Grep"],
): VerifiedPlan<unknown> {
  return {
    plan: {
      id: "bridge-test-plan",
      intent: "bridge test",
      steps: allowedPaths.map((p, i) => ({
        index: i,
        tool: tools[i] ?? tools[0],
        targetPath: p,
        reasoning: "test",
        dependsOn: [],
      })),
      requiredTools: tools,
      estimatedImpact: "P3",
      sources: [],
    },
    votes: [],
    approvalScore: 0.9,
  };
}

// ─── H5: Absolute-path bypass ─────────────────────────────────────────────────

describe("H5 — absolute paths are denied even when the normalised relative path is allowed", () => {
  it("rejects /src/auth.ts when only src/auth.ts is allowed", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Read", { file_path: "/src/auth.ts" })).toThrow(
      HarnessDeviationError,
    );
  });

  it("rejects backslash-absolute \\config\\app.json when only config/app.json is allowed", () => {
    const verified = makeVerifiedPlanWithPaths(["config/app.json"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Read", { file_path: "\\config\\app.json" })).toThrow(
      HarnessDeviationError,
    );
  });

  it("rejects ////config/app.json (repeated leading slashes)", () => {
    const verified = makeVerifiedPlanWithPaths(["config/app.json"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Read", { file_path: "////config/app.json" })).toThrow(
      HarnessDeviationError,
    );
  });

  it("still allows the exact relative path", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Read", { file_path: "src/auth.ts" })).not.toThrow();
  });
});

// ─── H6: All path-shaped arguments are checked ────────────────────────────────

describe("H6 — every path-shaped argument on a tool call is path-gated", () => {
  it("rejects Glob when pattern is an out-of-scope path (../../**/*.env)", () => {
    // pattern is checked as a path; ../../ is rejected regardless
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Glob", { path: "src/auth.ts", pattern: "../../**/*.env" }),
    ).toThrow(HarnessDeviationError);
  });

  it("rejects Grep when glob argument escapes the allowed list", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    // path is in-scope but glob escapes — both must be checked
    expect(() =>
      gate("Grep", { path: "src/auth.ts", glob: "../../**" }),
    ).toThrow(HarnessDeviationError);
  });

  it("allows Glob when all path arguments are in-scope", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts", "src"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Glob", { path: "src", pattern: "src/auth.ts" }),
    ).not.toThrow();
  });
});

// ─── H7: Shell-tool aliases are denied without allowShell ─────────────────────

describe("H7 — shell-tool aliases not in the original SHELL_TOOLS set are denied", () => {
  const shellAliases = ["sh", "PowerShell", "local_shell", "mcp__shell__run"];

  for (const alias of shellAliases) {
    it(`rejects "${alias}" even when it appears in requiredTools (no allowShell)`, () => {
      const verified = makeVerifiedPlanWithPaths([], [alias]);
      const gate = buildPermissionBridge(verified); // allowShell defaults to false

      expect(() => gate(alias, {})).toThrow(HarnessDeviationError);
    });
  }

  it("rejects str_replace_editor with out-of-scope path", () => {
    // str_replace_editor is a file-writing tool — it must be path-gated
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["str_replace_editor"]);
    const gate = buildPermissionBridge(verified);

    // path not in allowed list → denied
    expect(() =>
      gate("str_replace_editor", { file_path: "/etc/shadow" }),
    ).toThrow(HarnessDeviationError);
  });

  it("rejects mcp__filesystem__write_file with out-of-scope path", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["mcp__filesystem__write_file"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("mcp__filesystem__write_file", { file_path: "/etc/passwd" }),
    ).toThrow(HarnessDeviationError);
  });

  it("rejects computer (GUI automation) as a shell-class tool without allowShell", () => {
    const verified = makeVerifiedPlanWithPaths([], ["computer"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("computer", {})).toThrow(HarnessDeviationError);
  });

  it("rejects Task (agent spawning) as a shell-class tool without allowShell", () => {
    const verified = makeVerifiedPlanWithPaths([], ["Task"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Task", {})).toThrow(HarnessDeviationError);
  });
});

// ─── H8: allowShell flows from ExecuteOptions through to the bridge ───────────

describe("H8 — allowShell in ExecuteOptions is wired to the permission bridge", () => {
  it("execute() with allowShell:true allows Bash in a plan that lists it", async () => {
    // Build a plan that allows Bash
    const verified: VerifiedPlan<unknown> = {
      plan: {
        id: "shell-plan",
        intent: "shell test",
        steps: [
          { index: 0, tool: "Bash", targetPath: undefined, reasoning: "run command", dependsOn: [] },
        ],
        requiredTools: ["Bash"],
        estimatedImpact: "P1",
        sources: [],
      },
      votes: [],
      approvalScore: 0.8,
    };

    const shellHits: string[] = [];
    const sdkSession: SdkSession = {
      async run(options) {
        // Simulate a Bash tool call
        const decision = options.canUseTool?.("Bash", { command: "echo hi" });
        if (decision?.behavior === "allow") shellHits.push("Bash");
        return { finalMessage: "done" };
      },
    };

    const unit = execute(sdkSession, verified, { allowShell: true }, { isStub: false });
    await unit.run(ctx, { trustMode: "legacy" });

    // If allowShell was wired through, the bridge allowed the Bash call
    expect(shellHits).toContain("Bash");
  });

  it("execute() without allowShell blocks Bash even when listed in requiredTools", async () => {
    const verified: VerifiedPlan<unknown> = {
      plan: {
        id: "no-shell-plan",
        intent: "no shell test",
        steps: [],
        requiredTools: ["Bash"],
        estimatedImpact: "P1",
        sources: [],
      },
      votes: [],
      approvalScore: 0.8,
    };

    let caughtError: unknown;
    const sdkSession: SdkSession = {
      async run(options) {
        try {
          options.canUseTool?.("Bash", { command: "rm -rf /" });
        } catch (err) {
          caughtError = err;
        }
        return { finalMessage: "done" };
      },
    };

    const unit = execute(sdkSession, verified, {}, { isStub: false });
    await unit.run(ctx, { trustMode: "legacy" });

    expect(caughtError).toBeInstanceOf(HarnessDeviationError);
  });
});
