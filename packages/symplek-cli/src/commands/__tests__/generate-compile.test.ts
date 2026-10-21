/**
 * @module generate-compile — Mechanical compile gate for generator output.
 *
 * Takes the output of every generator path (YAML compiler, TypeScript template)
 * and type-checks it against the real @symplek/core declaration files. The test
 * fails if any generated code produces a TypeScript error.
 *
 * This is the durable guard that prevents a generator from shipping output
 * that users cannot compile (story CR-205/CR-206, blocker B11).
 *
 * Design: TypeScript compiler API with a custom baseUrl + paths mapping that
 * redirects "@symplek/core" and "@symplek/core/server" to the monorepo's built
 * declaration files. No subprocess spawn; type-check runs in-process.
 */

import ts from "typescript";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAgentTypeScript } from "../add.js";
import { generateFile } from "../generate.js";

// ─── Path constants ────────────────────────────────────────────────────────────
// THIS_DIR: packages/symplek-cli/src/commands/__tests__
// 5 levels up → monorepo root (C:/Gits/wefthq-weft)
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(THIS_DIR, "../../../../..");

// ─── Core type-checker ────────────────────────────────────────────────────────

/**
 * Type-check a TypeScript source string against the real @symplek/core types.
 * Returns the list of compiler error messages (empty = compiles clean).
 *
 * Compiler options mirror @symplek/cli's tsconfig as closely as possible so the
 * check reflects the same constraints a user project would apply.
 *
 * @param siblings - Optional additional files to write beside agent.ts (e.g.
 *   a fallback-agent stub that the generated import references).
 */
function typeCheckCode(
  sourceCode: string,
  label: string,
  siblings?: Record<string, string>,
): string[] {
  // Write to a real temp file — TypeScript module resolution requires real FS.
  const tmpDir = mkdtempSync(join(tmpdir(), "symplek-compile-gate-"));
  const filePath = join(tmpDir, "agent.ts");

  try {
    writeFileSync(filePath, sourceCode, "utf-8");

    if (siblings) {
      for (const [filename, content] of Object.entries(siblings)) {
        writeFileSync(join(tmpDir, filename), content, "utf-8");
      }
    }

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      // NodeJs (a.k.a. Node10) resolution: same as @symplek/cli's tsconfig.
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
      // Skip checking the @symplek/core declaration files themselves — we only
      // care that the GENERATED code compiles, not that @symplek/core's internals
      // type-check against each other.
      skipLibCheck: true,
      noEmit: true,
      // Redirect bare "@symplek/core" / "@symplek/core/server" imports to the built
      // declaration files in the monorepo.
      baseUrl: MONOREPO_ROOT,
      paths: {
        "@symplek/core": ["packages/symplek-core/dist"],
        "@symplek/core/server": ["packages/symplek-core/dist/server"],
      },
    };

    // Include sibling files in the program so the main file's imports resolve.
    const allFiles = [
      filePath,
      ...Object.keys(siblings ?? {}).map((f) => join(tmpDir, f)),
    ];

    const host = ts.createCompilerHost(compilerOptions);
    const program = ts.createProgram(allFiles, compilerOptions, host);
    const sourceFile = program.getSourceFile(filePath);
    const diagnostics = ts.getPreEmitDiagnostics(
      program,
      sourceFile ?? undefined,
    );

    return [...diagnostics]
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map(
        (d) =>
          `[${label}] ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
      );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generate compile gate (B11)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "symplek-compile-input-"));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("YAML compiler output", () => {
    it("basic agent (gpt-4o) compiles against real @symplek/core types", () => {
      const yamlPath = join(testDir, "basic-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: basic-agent
model: gpt-4o
systemPrompt: You are a helpful assistant.`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(true);

      const generatedCode = readFileSync(result.outputFile, "utf-8");
      const errors = typeCheckCode(generatedCode, "basic-agent");

      expect(errors).toEqual([]);
    });

    it("Anthropic model (claude-sonnet-4-5) compiles against real @symplek/core types", () => {
      const yamlPath = join(testDir, "anthropic-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: anthropic-agent
model: claude-sonnet-4-5
systemPrompt: You are a research assistant.
temperature: 0.5
maxTokens: 2048`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(true);

      const generatedCode = readFileSync(result.outputFile, "utf-8");
      const errors = typeCheckCode(generatedCode, "anthropic-agent");

      expect(errors).toEqual([]);
    });

    it("agent with retry + timeout operators compiles against real @symplek/core types", () => {
      const yamlPath = join(testDir, "ops-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: ops-agent
model: gpt-4o-mini
systemPrompt: Resilient agent.
operators:
  retry:
    maxAttempts: 3
    baseDelayMs: 1000
  timeout:
    ms: 30000`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(true);

      const generatedCode = readFileSync(result.outputFile, "utf-8");
      const errors = typeCheckCode(generatedCode, "ops-agent");

      expect(errors).toEqual([]);
    });

    it("agent with fallback operator compiles against real @symplek/core types", () => {
      const yamlPath = join(testDir, "fallback-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: fallback-agent
model: gpt-4o
systemPrompt: Primary agent.
operators:
  fallback:
    agent: backup-agent`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(true);

      const generatedCode = readFileSync(result.outputFile, "utf-8");
      // Verify the generator now imports backupAgent correctly before type-checking.
      expect(generatedCode).toContain(
        'import { backupAgent } from "./backup-agent"',
      );

      // Provide a minimal stub so TypeScript can resolve "./backup-agent".
      const backupAgentStub = [
        'import { AgentUnit } from "@symplek/core";',
        'import { ai } from "@symplek/core/server";',
        "export function backupAgent(prompt: string): AgentUnit<string> {",
        '  return AgentUnit.from((_ctx) => ai(prompt, { model: "gpt-4o-mini", system: "backup" }));',
        "}",
      ].join("\n");

      const errors = typeCheckCode(generatedCode, "fallback-agent", {
        "backup-agent.ts": backupAgentStub,
      });

      expect(errors).toEqual([]);
    });

    it("Google model (gemini-2.0-flash) compiles against real @symplek/core types", () => {
      const yamlPath = join(testDir, "google-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: google-agent
model: gemini-2.0-flash
systemPrompt: Google agent.`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(true);

      const generatedCode = readFileSync(result.outputFile, "utf-8");
      const errors = typeCheckCode(generatedCode, "google-agent");

      expect(errors).toEqual([]);
    });
  });

  describe("TypeScript template (symplek add agent --type typescript)", () => {
    it("template output for gpt-4o compiles against real @symplek/core types", () => {
      const templateCode = generateAgentTypeScript("my-agent", {
        model: "gpt-4o",
      });

      // Sanity-check that the template rendered correctly before type-checking.
      expect(templateCode).toContain('import { AgentUnit');
      expect(templateCode).toContain('import { ai }');

      const errors = typeCheckCode(templateCode, "typescript-template/gpt-4o");

      expect(errors).toEqual([]);
    });

    it("template output for claude-sonnet-4-5 compiles against real @symplek/core types", () => {
      const templateCode = generateAgentTypeScript("my-agent", {
        model: "claude-sonnet-4-5",
      });

      const errors = typeCheckCode(
        templateCode,
        "typescript-template/claude-sonnet-4-5",
      );

      expect(errors).toEqual([]);
    });
  });

  // ── Negative controls ────────────────────────────────────────────────────────
  // These tests ASSERT THAT THE GATE FAILS on the exact patterns that existed
  // before the B11 fix. Without them a silent regression (broken path, moved
  // dist) would make every positive control pass vacuously while the guard
  // no longer detects anything.
  describe("negative controls — gate must fail on pre-B11 broken patterns", () => {
    it("rejects AgentUnit.create which does not exist on @symplek/core", () => {
      // This is the verbatim broken pattern the YAML compiler emitted before B11.
      const brokenCode = [
        'import { AgentUnit } from "@symplek/core";',
        'import { ai } from "@symplek/core/server";',
        "export const myAgent = AgentUnit.create({",
        '  name: "my-agent",',
        '  model: "gpt-4o",',
        '  run: async (prompt: string) => ai(prompt, { model: "gpt-4o", system: "test" }),',
        "});",
      ].join("\n");

      const errors = typeCheckCode(brokenCode, "negative/AgentUnit.create");

      // The gate MUST surface an error — AgentUnit has no `create` static method.
      expect(errors.length).toBeGreaterThan(0);
      // The error should reference the offending symbol or the missing property.
      const combined = errors.join("\n");
      expect(combined).toMatch(/create/i);
    });

    it("rejects a defineTool import from @symplek/core which is not exported", () => {
      // This is the verbatim broken import the TypeScript template had before B11.
      const brokenCode = [
        'import { AgentUnit, defineTool } from "@symplek/core";',
        'import { ai } from "@symplek/core/server";',
        "export function myAgent(prompt: string): AgentUnit<string> {",
        "  return AgentUnit.from((_ctx) =>",
        '    ai(prompt, { model: "gpt-4o", system: "test" }),',
        "  );",
        "}",
      ].join("\n");

      const errors = typeCheckCode(brokenCode, "negative/defineTool");

      // The gate MUST surface an error — @symplek/core does not export `defineTool`.
      expect(errors.length).toBeGreaterThan(0);
      const combined = errors.join("\n");
      expect(combined).toMatch(/defineTool/i);
    });
  });
});
