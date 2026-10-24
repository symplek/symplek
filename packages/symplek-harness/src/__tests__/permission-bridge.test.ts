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
import { createContext } from "@symplek/core";
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
    // pattern carries a parent-dir escape — rejected regardless of whether
    // it is a path or a filter expression
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Glob", { path: "src/auth.ts", pattern: "../../**/*.env" }),
    ).toThrow(HarnessDeviationError);
  });

  it("rejects Grep when glob argument escapes the allowed list", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    // path is in-scope but glob contains "..", so it is not a plain glob
    expect(() =>
      gate("Grep", { path: "src/auth.ts", glob: "../../**" }),
    ).toThrow(HarnessDeviationError);
  });

  it("allows Glob when path is in-scope and pattern is an ordinary glob", () => {
    const verified = makeVerifiedPlanWithPaths(["src"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    // pattern is a glob expression, not a file path: it has to be a plain
    // glob, and is not looked up among the declared paths.
    expect(() =>
      gate("Glob", { path: "src", pattern: "**/*.ts" }),
    ).not.toThrow();
  });

  it("allows Grep with an ordinary regex pattern when path is in-scope", () => {
    // This used to be refused because "TODO" was looked up among the declared
    // paths. Grep's pattern is matched against file contents, so the gate
    // does not inspect it.
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Grep", { path: "src/auth.ts", pattern: "TODO" }),
    ).not.toThrow();
  });

  it("allows Grep with a regex that happens to look like a path", () => {
    // Grep's pattern is matched against file contents. It cannot change where
    // the search looks, so a leading slash or a ".." in it is not an escape.
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    for (const pattern of ["^/api/v1/", "\\.\\./secrets", "from '../config'"]) {
      expect(() =>
        gate("Grep", { path: "src/auth.ts", pattern }),
      ).not.toThrow();
    }
  });

  it("rejects Glob when pattern is absolute", () => {
    const verified = makeVerifiedPlanWithPaths(["src"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("Glob", { path: "src", pattern: "/etc/*" })).toThrow(
      /Glob argument "pattern"/,
    );
  });

  it("refuses every glob that is not a plain glob", () => {
    const verified = makeVerifiedPlanWithPaths(["src"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    const refused = [
      // Each of these reaches a parent directory or an absolute path under
      // some glob engine or shell, and none contains a literal "../" or starts
      // with "/". Review found them one at a time against a list of forbidden
      // spellings, which is why the gate now lists what is allowed instead.
      "{..,src}/**", // a brace alternative that is ".."
      ".\\./secrets/*", // an escaped dot
      "{/etc,src}/**", // an absolute brace alternative
      ".{.,x}/**", // a dot outside meeting a dot inside
      "{a,}/etc/**", // an empty alternative exposing the "/"
      "{C,x}:/Windows/**", // a drive letter built from an alternative
      "{~,a}/x", // a home folder built from an alternative
      "~/.ssh/*", // home-folder expansion
      "$HOME/*", // variable expansion
      ".*/**", // matches the entry ".." under glob(3)
      ".?/x",
      "src/.*/secrets",

      // Each breaks the rule in exactly one way, so no second reason hides it
      // if that one thing is let back in.
      "a\\b",
      "~",
      "a~b",
      "C:x",
      "a$b",
      "a`b",
      "a{b",
      "a}b",
      "a,b",
      "a[b",
      "a]b",
      "a(b",
      "a)b",
      "a|b",
      "a!b",
      "a@b",
      "a+b",
      "a b",
      "a\nb",
      "é",
      "-a",
      ".a",
      "a.",
      "a..b",
      "a//b",
      "a/",
      "/a",

      // Syntax some engines or shells accept and this gate does not.
      "`id`/x", // command substitution
      "[.][.]/secrets", // character classes
      "a[].]b", // a class whose first member is "]"
      "(.|x)./secrets", // regex-style alternation
      "@(a|b)/x", // extended glob group
      "../x",
      "./src/*.ts",

      // Harmless, and refused all the same: the cost of a short allow-list.
      "**/*.{ts,tsx}",
      "*.[jt]s",
      "**/.env*",
    ];
    for (const pattern of refused) {
      expect(
        () => gate("Glob", { path: "src", pattern }),
        JSON.stringify(pattern),
      ).toThrow(/Glob argument "pattern" on "Glob" is not a plain glob/);
    }
  });

  it("applies the same rule to the glob argument of Grep", () => {
    const verified = makeVerifiedPlanWithPaths(["src"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    for (const glob of ["a\\b", "~", "*.{ts,tsx}", ".*", "a/"]) {
      expect(
        () => gate("Grep", { path: "src", pattern: "TODO", glob }),
        JSON.stringify(glob),
      ).toThrow(/Glob argument "glob" on "Grep" is not a plain glob/);
    }
    expect(() =>
      gate("Grep", { path: "src", pattern: "TODO", glob: "**/*.ts" }),
    ).not.toThrow();
  });

  it("allows plain globs", () => {
    const verified = makeVerifiedPlanWithPaths(["src"], ["Glob"]);
    const gate = buildPermissionBridge(verified);

    const plain = [
      "*",
      "**/*",
      "**/*.ts",
      "*.d.ts",
      "components/*.test.ts",
      "src/**/__tests__/*.spec.tsx",
      "lib-*/index.js",
      "file?.txt",
      "README",
    ];
    for (const pattern of plain) {
      expect(
        () => gate("Glob", { path: "src", pattern }),
        JSON.stringify(pattern),
      ).not.toThrow();
    }
  });

  it("names the glob argument that was refused, not another one", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Grep", { path: "src/auth.ts", pattern: "TODO", glob: "../*.env" }),
    ).toThrow(/Glob argument "glob"/);
  });

  it("still path-checks a second path argument on a search tool", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Grep", {
        path: "src/auth.ts",
        file_path: "secrets/prod.env",
        pattern: "TODO",
      }),
    ).toThrow(/not in the verified plan's target paths/);
  });

  it("rejects Grep with no path argument (fail-closed: no search root)", () => {
    // A search with no root is refused — the gate cannot determine scope.
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts"], ["Grep"]);
    const gate = buildPermissionBridge(verified);

    expect(() =>
      gate("Grep", { pattern: "TODO" }),
    ).toThrow(HarnessDeviationError);
  });
});

// ─── Declared-path safety ─────────────────────────────────────────────────────

describe("declared-path safety — absolute targetPaths are rejected at build time", () => {
  it("throws at bridge construction when a plan declares an absolute targetPath", () => {
    const verified = makeVerifiedPlanWithPaths(["/etc/app.conf"], ["Read"]);

    // The plan declares an absolute path — the bridge must refuse to build
    // so the declared path cannot be silently mapped to a different relative file.
    expect(() => buildPermissionBridge(verified)).toThrow(HarnessDeviationError);
  });

  it("still accepts a plan with relative targetPaths only", () => {
    const verified = makeVerifiedPlanWithPaths(["src/auth.ts", "config/app.json"], ["Read"]);
    expect(() => buildPermissionBridge(verified)).not.toThrow();
  });
});

// ─── Web tools ────────────────────────────────────────────────────────────────

describe("web tools — WebSearch and WebFetch pass through after requiredTools check", () => {
  it("allows WebSearch when listed in requiredTools", () => {
    const verified = makeVerifiedPlanWithPaths([], ["WebSearch"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("WebSearch", { query: "typescript best practices" })).not.toThrow();
  });

  it("allows WebFetch when listed in requiredTools", () => {
    const verified = makeVerifiedPlanWithPaths([], ["WebFetch"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("WebFetch", { url: "https://example.com/docs" })).not.toThrow();
  });

  it("rejects WebSearch when NOT listed in requiredTools", () => {
    const verified = makeVerifiedPlanWithPaths([], ["Read"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("WebSearch", { query: "anything" })).toThrow(HarnessDeviationError);
  });

  it("rejects an unknown tool not in any category even when listed in requiredTools", () => {
    const verified = makeVerifiedPlanWithPaths([], ["UnknownTool"]);
    const gate = buildPermissionBridge(verified);

    expect(() => gate("UnknownTool", {})).toThrow(HarnessDeviationError);
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
