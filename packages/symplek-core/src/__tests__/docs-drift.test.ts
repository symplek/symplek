/**
 * @module docs-drift — Mechanical README TypeScript block drift guard
 * @description Extracts fenced TypeScript code blocks from all workspace README
 *   files and fails if any block references a non-existent @symplek/core API.
 *   Catches the class of drift confirmed in audit BRIEF findings B11/N48/N58/N70.
 *   Add new FORBIDDEN entries here as future APIs are removed or renamed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─── Forbidden API patterns ───────────────────────────────────────────────────
// Each entry names a symbol that no longer (or never did) exist in the public
// @symplek/core surface but may appear in README examples if docs drift from code.

interface ForbiddenPattern {
  pattern: RegExp;
  message: string;
}

const FORBIDDEN: ForbiddenPattern[] = [
  {
    // AgentUnit.create() was never a public static method. AgentUnit.of() and
    // AgentUnit.from() are the two factory entry points. (BRIEF B11/N48)
    pattern: /AgentUnit\.create\s*\(/,
    message:
      "AgentUnit.create() does not exist — use AgentUnit.of() or AgentUnit.from() (BRIEF B11/N48)",
  },
  {
    // defineTool is not exported from @symplek/core. Template-generated code
    // incorrectly imports it, confirmed in BRIEF B11/N58. Any README that shows
    // this import would mislead consumers.
    pattern:
      /import\s*\{[^}]*\bdefineTool\b[^}]*\}\s*from\s*['"]@symplek\/core['"]/,
    message:
      'defineTool is not exported from "@symplek/core" (BRIEF B11/N58)',
  },
  {
    // AgentUnit.create used in non-import contexts (e.g. method call chaining).
    // Belt-and-suspenders companion to the static-method check above.
    pattern: /new\s+AgentUnit\s*\(/,
    message:
      "AgentUnit is not directly constructable — use AgentUnit.of() or AgentUnit.from() (BRIEF N48)",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Walk dir recursively, collecting README.md paths; skips common non-source dirs. */
function findReadmes(dir: string): string[] {
  const SKIP = new Set(["node_modules", ".git", "dist", ".cache", "coverage"]);
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findReadmes(full));
    } else if (entry.name === "README.md") {
      results.push(full);
    }
  }
  return results.sort();
}

/** Extract the content of all ```ts and ```typescript fenced blocks. */
function extractTsBlocks(content: string): string[] {
  // Use non-greedy dotall match; backtick fences must start at line start.
  // matchAll avoids assignment-in-expression (Biome noAssignInExpressions).
  const re = /^```(?:ts|typescript)\r?\n([\s\S]*?)^```/gm;
  return [...content.matchAll(re)].map((m) => m[1]);
}

// ─── Scan workspace ───────────────────────────────────────────────────────────

// __dirname resolves to packages/symplek-core/src/__tests__; workspace root is 4 up.
const WORKSPACE_ROOT = resolve(__dirname, "../../../../..");
const allReadmes = findReadmes(WORKSPACE_ROOT);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("docs-drift: README fenced TypeScript blocks", () => {
  it("discovers at least one README to check", () => {
    expect(allReadmes.length).toBeGreaterThan(0);
  });

  for (const readme of allReadmes) {
    const relPath = readme
      .replace(WORKSPACE_ROOT, "")
      .replace(/^[/\\]/, "")
      .replace(/\\/g, "/");
    const content = readFileSync(readme, "utf8");
    const blocks = extractTsBlocks(content);

    if (blocks.length === 0) {
      // No fenced TS blocks — nothing to check. Skip silently.
      continue;
    }

    it(`${relPath} — ${blocks.length} block(s) contain no forbidden API references`, () => {
      const violations: string[] = [];

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        for (const { pattern, message } of FORBIDDEN) {
          if (pattern.test(block)) {
            // Include a short excerpt so the CI log points to the exact line.
            const excerpt = block
              .split("\n")
              .find((line) => pattern.test(line))
              ?.trim()
              .slice(0, 120);
            violations.push(
              `  Block ${i + 1}: ${message}\n    Found: ${excerpt ?? "(multi-line match)"}`,
            );
          }
        }
      }

      expect(violations, `\n${violations.join("\n")}`).toHaveLength(0);
    });
  }
});
