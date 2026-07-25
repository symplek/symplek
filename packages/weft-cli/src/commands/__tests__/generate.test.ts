/**
 * Tests for `Weft generate` command
 * Story: 03.05
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCommand, generateFile } from "../generate.js";

describe("generate command", () => {
  describe("generateCommand", () => {
    it("creates command with correct name and description", () => {
      const command = generateCommand();

      expect(command.name()).toBe("generate");
      expect(command.description()).toContain("Generate TypeScript");
    });

    it("has required options", () => {
      const command = generateCommand();
      const options = command.options || [];
      const optionNames = options.map((o) => o.long);

      expect(optionNames).toContain("--watch");
      expect(optionNames).toContain("--output");
      expect(optionNames).toContain("--quiet");
    });

    it("has correct short options", () => {
      const command = generateCommand();
      const options = command.options || [];
      const shortOptions = options.map((o) => o.short);

      expect(shortOptions).toContain("-w");
      expect(shortOptions).toContain("-o");
      expect(shortOptions).toContain("-q");
    });

    it("has default pattern argument", () => {
      const command = generateCommand();
      const args = command.registeredArguments;

      expect(args.length).toBeGreaterThan(0);
      expect(args[0].name()).toBe("pattern");
      expect(args[0].defaultValue).toBe("agents/**/*.yaml");
    });
  });
});

describe("generate file function", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(
      tmpdir(),
      `Weft-generate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("successful generation", () => {
    it("generates TypeScript from valid YAML", () => {
      const yamlPath = join(testDir, "my-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: my-agent
model: gpt-4o
systemPrompt: You are a helpful assistant.`,
      );

      const result = generateFile(yamlPath, undefined, true);

      expect(result.success).toBe(true);
      expect(result.inputFile).toBe(yamlPath);
      expect(result.outputFile).toBe(join(testDir, "my-agent.ts"));
      expect(existsSync(result.outputFile)).toBe(true);

      const content = readFileSync(result.outputFile, "utf-8");
      // Correct API: imports AgentUnit from the weft-core root and ai() from
      // the server subpath — no @ai-sdk/* direct imports (B11 fix).
      expect(content).toContain('import { AgentUnit } from "weft-core"');
      expect(content).toContain('import { ai } from "weft-core/server"');
      // Generated agent is a factory function (not a const AgentUnit.create call).
      expect(content).toContain("export function myAgent(prompt: string)");
      // Model is passed as a string to ai(), not as a provider-SDK call.
      expect(content).toContain('model: "gpt-4o"');
      // System prompt is emitted correctly.
      expect(content).toContain("system:");
      // No forbidden patterns.
      expect(content).not.toContain("AgentUnit.create");
      expect(content).not.toContain("defineTool");
      expect(content).not.toContain('@ai-sdk/');
    });

    it("generates to custom output directory", () => {
      const yamlPath = join(testDir, "agent.yaml");
      const outputDir = join(testDir, "generated");
      writeFileSync(
        yamlPath,
        `name: output-agent
model: claude-sonnet-4-5
systemPrompt: Test agent.`,
      );

      const result = generateFile(yamlPath, outputDir, true);

      expect(result.success).toBe(true);
      expect(result.outputFile).toBe(join(outputDir, "agent.ts"));
      expect(existsSync(result.outputFile)).toBe(true);
    });

    it("creates output directory if needed", () => {
      const yamlPath = join(testDir, "agent.yaml");
      const outputDir = join(testDir, "deep", "nested", "output");
      writeFileSync(
        yamlPath,
        `name: nested-agent
model: gpt-4o-mini
systemPrompt: Nested test.`,
      );

      expect(existsSync(outputDir)).toBe(false);

      const result = generateFile(yamlPath, outputDir, true);

      expect(result.success).toBe(true);
      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(result.outputFile)).toBe(true);
    });
  });

  describe("model handling", () => {
    it("passes OpenAI model as a string to ai()", () => {
      const yamlPath = join(testDir, "openai-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: openai-agent
model: gpt-4o-mini
systemPrompt: OpenAI test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "openai-agent.ts"), "utf-8");

      // Model is a plain string passed to ai(); no @ai-sdk/* import.
      expect(content).toContain('model: "gpt-4o-mini"');
      expect(content).not.toContain("@ai-sdk/");
    });

    it("passes Anthropic model as a string to ai()", () => {
      const yamlPath = join(testDir, "anthropic-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: anthropic-agent
model: claude-sonnet-4-5
systemPrompt: Anthropic test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(
        join(testDir, "anthropic-agent.ts"),
        "utf-8",
      );

      expect(content).toContain('model: "claude-sonnet-4-5"');
      expect(content).not.toContain("@ai-sdk/");
    });

    it("passes Google model as a string to ai()", () => {
      const yamlPath = join(testDir, "google-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: google-agent
model: gemini-2.0-flash
systemPrompt: Google test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "google-agent.ts"), "utf-8");

      expect(content).toContain('model: "gemini-2.0-flash"');
      expect(content).not.toContain("@ai-sdk/");
    });

    it("rejects deprecated claude-3-* model IDs", () => {
      const yamlPath = join(testDir, "old-model-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: old-model-agent
model: claude-3-opus
systemPrompt: Test.`,
      );

      const result = generateFile(yamlPath, undefined, true);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported model");
    });
  });

  describe("optional fields", () => {
    it("includes description when present", () => {
      const yamlPath = join(testDir, "desc-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: desc-agent
model: gpt-4o
systemPrompt: Test.
description: A helpful agent for testing.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "desc-agent.ts"), "utf-8");

      // Generator emits description as a JSDoc comment above the export.
      expect(content).toContain("/** A helpful agent for testing. */");
    });

    it("includes temperature when present", () => {
      const yamlPath = join(testDir, "temp-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: temp-agent
model: gpt-4o
systemPrompt: Test.
temperature: 0.7`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "temp-agent.ts"), "utf-8");

      expect(content).toContain("temperature: 0.7");
    });

    it("includes maxTokens when present", () => {
      const yamlPath = join(testDir, "tokens-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: tokens-agent
model: gpt-4o
systemPrompt: Test.
maxTokens: 4096`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "tokens-agent.ts"), "utf-8");

      expect(content).toContain("maxTokens: 4096");
    });

    it("includes timeout when present", () => {
      const yamlPath = join(testDir, "timeout-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: timeout-agent
model: gpt-4o
systemPrompt: Test.
timeout: 60000`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "timeout-agent.ts"), "utf-8");

      expect(content).toContain("timeout: 60000");
    });
  });

  describe("tools handling", () => {
    it("includes tool comment for simple tools", () => {
      const yamlPath = join(testDir, "tools-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: tools-agent
model: gpt-4o
systemPrompt: Test.
tools:
  - webSearch
  - calculator`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "tools-agent.ts"), "utf-8");

      // Generator emits a reminder comment inside the ai() options block.
      expect(content).toContain(
        '// TODO: wire tools: "webSearch", "calculator"',
      );
    });

    it("handles tool config objects", () => {
      const yamlPath = join(testDir, "toolconfig-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: toolconfig-agent
model: gpt-4o
systemPrompt: Test.
tools:
  - name: complexTool
    enabled: true`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(
        join(testDir, "toolconfig-agent.ts"),
        "utf-8",
      );

      expect(content).toContain("complexTool");
    });
  });

  describe("operators handling", () => {
    it("generates retry operator chain", () => {
      const yamlPath = join(testDir, "retry-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: retry-agent
model: gpt-4o
systemPrompt: Test.
operators:
  retry:
    maxAttempts: 5
    baseDelayMs: 2000`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "retry-agent.ts"), "utf-8");

      // Operator variant is a function, not a const (B11 fix).
      expect(content).toContain("export function retryAgentWithOperators");
      expect(content).toContain(".retry(5, { baseDelayMs: 2000 })");
    });

    it("generates timeout operator chain", () => {
      const yamlPath = join(testDir, "timeout-op-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: timeout-op-agent
model: gpt-4o
systemPrompt: Test.
operators:
  timeout:
    ms: 45000`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(
        join(testDir, "timeout-op-agent.ts"),
        "utf-8",
      );

      expect(content).toContain(".timeout(45000)");
    });

    it("generates fallback operator chain with agent", () => {
      const yamlPath = join(testDir, "fallback-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: fallback-agent
model: gpt-4o
systemPrompt: Test.
operators:
  fallback:
    agent: backup-agent`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "fallback-agent.ts"), "utf-8");

      // Generator imports the fallback factory and calls it with the same prompt
      // so .fallback() receives an AgentUnit<string>, not a bare function.
      expect(content).toContain(
        'import { backupAgent } from "./backup-agent"',
      );
      expect(content).toContain(".fallback(backupAgent(prompt))");
    });

    it("generates multiple operators", () => {
      const yamlPath = join(testDir, "multi-op-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: multi-op-agent
model: gpt-4o
systemPrompt: Test.
operators:
  retry:
    maxAttempts: 3
  timeout:
    ms: 30000`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "multi-op-agent.ts"), "utf-8");

      expect(content).toContain(".retry(3, { baseDelayMs: 1000 })");
      expect(content).toContain(".timeout(30000)");
    });
  });

  describe("multi-line system prompts", () => {
    it("handles multi-line prompts with template literals", () => {
      const yamlPath = join(testDir, "multiline-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: multiline-agent
model: gpt-4o
systemPrompt: |
  You are a helpful assistant.
  You should always be friendly.
  Never be rude.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(
        join(testDir, "multiline-agent.ts"),
        "utf-8",
      );

      // Generator emits multi-line prompts as a JSON double-quoted string
      // in the ai() `system` field — no template literals, no injection surface.
      expect(content).toContain('system: "');
      expect(content).toContain("You are a helpful assistant.");
    });

    it("escapes template literal special characters", () => {
      const yamlPath = join(testDir, "escape-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: escape-agent
model: gpt-4o
systemPrompt: "Use \`backticks\` carefully"`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "escape-agent.ts"), "utf-8");

      // Backticks are safe inside JSON double-quoted strings — no escaping
      // needed since we no longer emit template literals.
      expect(content).toContain("`backticks`");
    });
  });

  describe("type exports", () => {
    it("generates result type export", () => {
      const yamlPath = join(testDir, "type-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: type-agent
model: gpt-4o
systemPrompt: Test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "type-agent.ts"), "utf-8");

      // ReturnType of the factory function (AgentUnit) then of .run() on that.
      expect(content).toContain(
        'export type TypeAgentResult = Awaited<ReturnType<ReturnType<typeof typeAgent>["run"]>>',
      );
    });

    it("generates WithOperators result type when operators present", () => {
      const yamlPath = join(testDir, "optype-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: optype-agent
model: gpt-4o
systemPrompt: Test.
operators:
  retry:
    maxAttempts: 3`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "optype-agent.ts"), "utf-8");

      expect(content).toContain("export type OptypeAgentWithOperatorsResult");
    });
  });

  describe("error handling", () => {
    it("returns error for non-existent file", () => {
      const result = generateFile(
        join(testDir, "nonexistent.yaml"),
        undefined,
        true,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error for invalid YAML", () => {
      const yamlPath = join(testDir, "invalid.yaml");
      writeFileSync(yamlPath, "this is not: valid: yaml: syntax:");

      const result = generateFile(yamlPath, undefined, true);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error for missing required fields", () => {
      const yamlPath = join(testDir, "missing-fields.yaml");
      writeFileSync(yamlPath, "name: only-name");

      const result = generateFile(yamlPath, undefined, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing required field");
    });

    it("returns error for unsupported model", () => {
      const yamlPath = join(testDir, "bad-model.yaml");
      writeFileSync(
        yamlPath,
        `name: bad-model
model: unsupported-model
systemPrompt: Test.`,
      );

      const result = generateFile(yamlPath, undefined, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported model");
    });

    it("returns error for invalid agent name", () => {
      const yamlPath = join(testDir, "bad-name.yaml");
      writeFileSync(
        yamlPath,
        `name: InvalidCamelCase
model: gpt-4o
systemPrompt: Test.`,
      );

      const result = generateFile(yamlPath, undefined, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid agent name");
    });
  });

  describe("header comments", () => {
    it("includes source file reference", () => {
      const yamlPath = join(testDir, "header-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: header-agent
model: gpt-4o
systemPrompt: Test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "header-agent.ts"), "utf-8");

      expect(content).toContain("// Generated from");
      expect(content).toContain("header-agent.yaml");
    });

    it("includes regeneration instruction", () => {
      const yamlPath = join(testDir, "regen-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: regen-agent
model: gpt-4o
systemPrompt: Test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "regen-agent.ts"), "utf-8");

      expect(content).toContain("npx Weft generate");
    });
  });

  describe("case conversion", () => {
    it("converts kebab-case to camelCase for export", () => {
      const yamlPath = join(testDir, "kebab-case-agent.yaml");
      writeFileSync(
        yamlPath,
        `name: kebab-case-agent
model: gpt-4o
systemPrompt: Test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(
        join(testDir, "kebab-case-agent.ts"),
        "utf-8",
      );

      // Generator emits a factory function, not a const.
      expect(content).toContain("export function kebabCaseAgent");
      expect(content).not.toContain("kebab-case-agent(");
    });

    it("converts to PascalCase for types", () => {
      const yamlPath = join(testDir, "pascal-test.yaml");
      writeFileSync(
        yamlPath,
        `name: pascal-test
model: gpt-4o
systemPrompt: Test.`,
      );

      generateFile(yamlPath, undefined, true);
      const content = readFileSync(join(testDir, "pascal-test.ts"), "utf-8");

      expect(content).toContain("export type PascalTestResult");
    });
  });
});
