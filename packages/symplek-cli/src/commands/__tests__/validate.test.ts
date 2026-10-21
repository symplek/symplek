/**
 * Tests for Symplek validate command
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateFile } from "../validate.js";

// Test directory for temporary files
const TEST_DIR = join(process.cwd(), ".test-validate-temp");

describe("Symplek validate command", () => {
  beforeEach(() => {
    // Create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "agents"), { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("validateFile", () => {
    it("should validate a correct YAML file", () => {
      const filePath = join(TEST_DIR, "agents", "valid.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect missing required field: name", () => {
      const filePath = join(TEST_DIR, "agents", "missing-name.yaml");
      const content = `
model: claude-sonnet-4-5
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain("name");
    });

    it("should detect missing required field: model", () => {
      const filePath = join(TEST_DIR, "agents", "missing-model.yaml");
      const content = `
name: my-agent
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes("model")),
      ).toBe(true);
    });

    it("should detect missing required field: systemPrompt", () => {
      const filePath = join(TEST_DIR, "agents", "missing-prompt.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.toLowerCase().includes("systemprompt"),
        ),
      ).toBe(true);
    });

    it("should detect a malformed model id", () => {
      const filePath = join(TEST_DIR, "agents", "invalid-model.yaml");
      const content = `
name: my-agent
model: "gpt 4o; rm -rf"
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.suggestion?.includes("provider model id")),
      ).toBe(true);
    });

    it("should accept a well-formed model id it has never heard of", () => {
      const filePath = join(TEST_DIR, "agents", "new-model.yaml");
      const content = `
name: my-agent
model: vendor/some-model-9.1:preview
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      expect(validateFile(filePath).valid).toBe(true);
    });

    it("should detect invalid name format (not kebab-case)", () => {
      const filePath = join(TEST_DIR, "agents", "invalid-name.yaml");
      const content = `
name: MyAgent
model: claude-sonnet-4-5
systemPrompt: You are a helpful assistant.
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes("format")),
      ).toBe(true);
    });

    it("should validate full agent config with all fields", () => {
      const filePath = join(TEST_DIR, "agents", "full.yaml");
      const content = `
name: research-agent
model: gpt-4o
systemPrompt: You are a research assistant.
description: Helps with research tasks
version: "1.2.3"
temperature: 0.7
maxTokens: 4096
timeout: 30000
retries:
  maxAttempts: 3
  backoffMs: 1000
  backoffMultiplier: 2
tools:
  - search
  - name: calculator
    enabled: true
tracking:
  enabled: true
  defaultSource: agent
  defaultConfidence: 0.8
operators:
  retry:
    maxAttempts: 3
  timeout:
    ms: 30000
tags:
  - research
  - analysis
metadata:
  author: test
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect additional properties not in schema", () => {
      const filePath = join(TEST_DIR, "agents", "extra-props.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
systemPrompt: You are a helpful assistant.
unknownField: should not be here
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes("unknown")),
      ).toBe(true);
    });

    it("should provide line numbers in errors", () => {
      const filePath = join(TEST_DIR, "agents", "with-line.yaml");
      const content = `name: my-agent
model: "not a model id"
systemPrompt: Test
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      // Line should be around 2 where model is defined
      expect(result.errors[0].line).toBeGreaterThanOrEqual(1);
    });

    it("should handle file not found", () => {
      const result = validateFile(join(TEST_DIR, "nonexistent.yaml"));

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("not found");
    });

    it("should handle invalid YAML syntax", () => {
      const filePath = join(TEST_DIR, "agents", "invalid-syntax.yaml");
      const content = `
name: my-agent
  model: claude-sonnet-4-5
    systemPrompt: Bad indentation
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      // YAML parse errors should be caught
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should detect temperature out of range", () => {
      const filePath = join(TEST_DIR, "agents", "temp-out-of-range.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
systemPrompt: Test
temperature: 5
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.toLowerCase().includes("maximum")),
      ).toBe(true);
    });

    it("should provide suggestions for common errors", () => {
      const filePath = join(TEST_DIR, "agents", "needs-suggestion.yaml");
      const content = `
model: claude-sonnet-4-5
systemPrompt: Test
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      const nameError = result.errors.find((e) => e.message.includes("name"));
      expect(nameError?.suggestion).toBeDefined();
    });

    it("should validate tracking configuration", () => {
      const filePath = join(TEST_DIR, "agents", "tracking.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
systemPrompt: Test
tracking:
  enabled: true
  defaultSource: invalid-source
  defaultConfidence: 0.8
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
    });

    it("should validate operators configuration", () => {
      const filePath = join(TEST_DIR, "agents", "operators.yaml");
      const content = `
name: my-agent
model: claude-sonnet-4-5
systemPrompt: Test
operators:
  retry:
    maxAttempts: 5
  consensus:
    quorum: 0.75
    agents:
      - agent1
      - agent2
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.valid).toBe(true);
    });

    it("should handle empty YAML file", () => {
      const filePath = join(TEST_DIR, "agents", "empty.yaml");
      writeFileSync(filePath, "");

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
    });

    it("should handle scalar YAML (not an object)", () => {
      const filePath = join(TEST_DIR, "agents", "scalar.yaml");
      writeFileSync(filePath, "just a string");

      const result = validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("object");
    });
  });

  describe("validation error format", () => {
    it("should include file path in errors", () => {
      const filePath = join(TEST_DIR, "agents", "test.yaml");
      const content = `
model: claude-sonnet-4-5
systemPrompt: Test
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(result.file).toBe(filePath);
      expect(result.errors[0].file).toBe(filePath);
    });

    it("should include column in errors", () => {
      const filePath = join(TEST_DIR, "agents", "test.yaml");
      const content = `
name: my-agent
model: "not a model id"
systemPrompt: Test
`;
      writeFileSync(filePath, content);

      const result = validateFile(filePath);

      expect(typeof result.errors[0].column).toBe("number");
    });
  });
});
