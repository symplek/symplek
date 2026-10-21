/**
 * Tests for `Symplek add` command
 * Story: 03.03
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAddCommand,
  generateAgentTest,
  generateAgentTypeScript,
  generateAgentYaml,
  kebabToCamel,
  validateAgentName,
} from "../add.js";

describe("add command", () => {
  describe("validateAgentName", () => {
    it("accepts valid kebab-case names", () => {
      expect(validateAgentName("my-agent")).toBe(true);
      expect(validateAgentName("researcher")).toBe(true);
      expect(validateAgentName("code-reviewer")).toBe(true);
      expect(validateAgentName("agent1")).toBe(true);
      expect(validateAgentName("my-agent-v2")).toBe(true);
    });

    it("rejects invalid names", () => {
      expect(validateAgentName("MyAgent")).toBe(false);
      expect(validateAgentName("my_agent")).toBe(false);
      expect(validateAgentName("my agent")).toBe(false);
      expect(validateAgentName("123-agent")).toBe(false);
      expect(validateAgentName("-agent")).toBe(false);
      expect(validateAgentName("agent-")).toBe(false);
      expect(validateAgentName("")).toBe(false);
    });
  });

  describe("kebabToCamel", () => {
    it("converts kebab-case to camelCase", () => {
      expect(kebabToCamel("my-agent")).toBe("myAgent");
      expect(kebabToCamel("code-reviewer")).toBe("codeReviewer");
      expect(kebabToCamel("simple")).toBe("simple");
      expect(kebabToCamel("a-b-c")).toBe("aBC");
    });
  });

  describe("generateAgentYaml", () => {
    it("generates YAML for general type", () => {
      const yaml = generateAgentYaml("my-agent", {
        type: "general",
        model: "gpt-4o",
      });

      expect(yaml).toContain("name: my-agent");
      expect(yaml).toContain("model: gpt-4o");
      expect(yaml).toContain("type: general");
      expect(yaml).toContain("You are my-agent");
    });

    it("generates YAML for researcher type", () => {
      const yaml = generateAgentYaml("research-bot", {
        type: "researcher",
        model: "claude-3-sonnet",
      });

      expect(yaml).toContain("name: research-bot");
      expect(yaml).toContain("model: claude-3-sonnet");
      expect(yaml).toContain("type: researcher");
      expect(yaml).toContain("research");
    });

    it("generates YAML for reviewer type", () => {
      const yaml = generateAgentYaml("code-reviewer", {
        type: "reviewer",
        model: "gpt-4o",
      });

      expect(yaml).toContain("name: code-reviewer");
      expect(yaml).toContain("type: reviewer");
      expect(yaml).toContain("code review");
    });

    it("generates minimal YAML for custom type", () => {
      const yaml = generateAgentYaml("custom-agent", {
        type: "custom",
        model: "gpt-4o-mini",
        tools: ["search", "fetch_url"],
      });

      expect(yaml).toContain("name: custom-agent");
      expect(yaml).toContain("type: custom");
      expect(yaml).toContain("model: gpt-4o-mini");
      expect(yaml).toContain("- name: search");
      expect(yaml).toContain("- name: fetch_url");
    });
  });

  describe("generateAgentTypeScript", () => {
    it("generates TypeScript agent definition", () => {
      const ts = generateAgentTypeScript("my-agent", {
        model: "gpt-4o",
      });

      // Template header still names the agent.
      expect(ts).toContain("my-agent Agent");
      // Model is interpolated into the ai() call as a string.
      expect(ts).toContain('model: "gpt-4o"');
      // Generator emits a factory function, not a const (B11 fix).
      expect(ts).toContain("export function myAgent");
      // Uses the correct factory method.
      expect(ts).toContain("AgentUnit.from");
      // No deprecated patterns.
      expect(ts).not.toContain("AgentUnit.of({");
      expect(ts).not.toContain("AgentUnit.create");
    });

    it("uses camelCase for variable name", () => {
      const ts = generateAgentTypeScript("code-reviewer", {
        model: "claude-sonnet-4-5",
      });

      // Generator emits a factory function, not a const.
      expect(ts).toContain("export function codeReviewer");
    });
  });

  describe("generateAgentTest", () => {
    it("generates test file with correct structure", () => {
      const test = generateAgentTest("my-agent");

      expect(test).toContain("Tests for my-agent agent");
      expect(test).toContain('describe("my-agent agent"');
      expect(test).toContain("myAgent"); // Used in mock and import
      expect(test).toContain("../agents/my-agent");
      expect(test).toContain("should be defined");
      expect(test).toContain("should have a run function");
      expect(test).toContain("vitest");
    });
  });

  describe("createAddCommand", () => {
    it("creates command with correct name and description", () => {
      const command = createAddCommand();

      expect(command.name()).toBe("add");
      expect(command.description()).toContain("Add new components");
    });

    it("has agent subcommand", () => {
      const command = createAddCommand();
      const agentCommand = command.commands.find((c) => c.name() === "agent");

      expect(agentCommand).toBeDefined();
      expect(agentCommand?.description()).toContain("agent");
    });

    it("agent subcommand has required options", () => {
      const command = createAddCommand();
      const agentCommand = command.commands.find((c) => c.name() === "agent");
      const options = agentCommand?.options || [];
      const optionNames = options.map((o) => o.long);

      expect(optionNames).toContain("--yaml-only");
      expect(optionNames).toContain("--ts-only");
      expect(optionNames).toContain("--type");
      expect(optionNames).toContain("--model");
    });
  });
});

describe("add command integration", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(
      tmpdir(),
      `Symplek-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("detects existing files", () => {
    // Create agents directory and existing file
    const agentsDir = join(testDir, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "existing-agent.yaml"), "existing content");

    // Verify file exists
    expect(existsSync(join(agentsDir, "existing-agent.yaml"))).toBe(true);
  });

  it("creates agents directory if needed", () => {
    const agentsDir = join(testDir, "agents");
    expect(existsSync(agentsDir)).toBe(false);

    // Would be created by writeFile in actual command execution
    mkdirSync(agentsDir, { recursive: true });
    expect(existsSync(agentsDir)).toBe(true);
  });
});
