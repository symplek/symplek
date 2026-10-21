/**
 * Tests for `Symplek add` command
 * Story: 03.03
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAddCommand,
  generateAgentTest,
  generateAgentTypeScript,
  generateAgentYaml,
  kebabToCamel,
  validateAgentName,
} from "../add.js";
import { generateFile } from "../generate.js";
import { validateFile } from "../validate.js";

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
      expect(yaml).toContain('model: "gpt-4o"');
      // 'type' is not a valid schema field — templates must not emit it.
      expect(yaml).not.toContain("type: general");
      expect(yaml).toContain("systemPrompt:");
      expect(yaml).toContain("You are my-agent");
    });

    it("generates YAML for researcher type", () => {
      const yaml = generateAgentYaml("research-bot", {
        type: "researcher",
        model: "gpt-4o",
      });

      expect(yaml).toContain("name: research-bot");
      expect(yaml).toContain('model: "gpt-4o"');
      // 'type' is not a valid schema field — templates must not emit it.
      expect(yaml).not.toContain("type: researcher");
      expect(yaml).toContain("systemPrompt:");
      expect(yaml).toContain("research");
    });

    it("generates YAML for reviewer type", () => {
      const yaml = generateAgentYaml("code-reviewer", {
        type: "reviewer",
        model: "gpt-4o",
      });

      expect(yaml).toContain("name: code-reviewer");
      // 'type' is not a valid schema field — templates must not emit it.
      expect(yaml).not.toContain("type: reviewer");
      expect(yaml).toContain("systemPrompt:");
      expect(yaml).toContain("code review");
    });

    it("generates minimal YAML for custom type", () => {
      const yaml = generateAgentYaml("custom-agent", {
        type: "custom",
        model: "gpt-4o-mini",
        tools: ["search", "fetch_url"],
      });

      expect(yaml).toContain("name: custom-agent");
      // 'type' is not a valid schema field — templates must not emit it.
      expect(yaml).not.toContain("type: custom");
      expect(yaml).toContain("systemPrompt:");
      expect(yaml).toContain('model: "gpt-4o-mini"');
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

      expect(test).toContain("Tests for the my-agent agent");
      expect(test).toContain('describe("my-agent agent"');
      expect(test).toContain('import { myAgent } from "../agents/my-agent";');
      expect(test).toContain("vitest");
      // The generated test must exercise the user's real agent: only the
      // model call may be replaced, never the agent module itself.
      expect(test).toContain('vi.mock("@symplek/core/server"');
      expect(test).not.toContain('vi.mock("../agents/');
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

describe("symplek add agent, run for real in a temp project", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(
      tmpdir(),
      `symplek-add-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, "package.json"),
      JSON.stringify({ name: "tmp", devDependencies: { vitest: "^2.1.0" } }),
    );
    process.chdir(testDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  const add = (...args: string[]) =>
    createAddCommand().parseAsync(["agent", ...args], { from: "user" });
  const written = (...parts: string[]) => existsSync(join(testDir, ...parts));

  it.each(["general", "researcher", "reviewer", "custom"])(
    "--type %s writes a YAML definition that the CLI's own validate accepts",
    async (type) => {
      await add("helper", "--type", type, "--model", "gpt-4o");

      expect(written("agents", "helper.yaml")).toBe(true);
      expect(written("agents", "helper.ts")).toBe(true);
      expect(written("tests", "helper.test.ts")).toBe(true);
      const result = validateFile(join(testDir, "agents", "helper.yaml"));
      expect(result.errors).toEqual([]);
    },
  );

  it("--type typescript writes the TypeScript agent and no YAML file", async () => {
    await add("helper", "--type", "typescript", "--model", "gpt-4o");

    expect(written("agents", "helper.ts")).toBe(true);
    expect(written("agents", "helper.yaml")).toBe(false);
    expect(
      readFileSync(join(testDir, "agents", "helper.ts"), "utf-8"),
    ).toContain("export function helper(");
  });

  it("rejects an unknown --type and writes nothing", async () => {
    await expect(
      add("helper", "--type", "wizard", "--model", "gpt-4o"),
    ).rejects.toThrow("process.exit(1)");
    expect(written("agents")).toBe(false);
  });

  it("rejects a malformed --model and writes nothing", async () => {
    await expect(
      add("helper", "--type", "general", "--model", "gpt 4o; rm -rf"),
    ).rejects.toThrow("process.exit(1)");
    expect(written("agents")).toBe(false);
  });

  it("generates the TypeScript for a YAML agent from its YAML", async () => {
    await add("helper", "--type", "general", "--model", "gpt-4o");

    const ts = readFileSync(join(testDir, "agents", "helper.ts"), "utf-8");
    expect(ts.startsWith("// Generated from")).toBe(true);
    // Running generate again is a no-op on content, not a clobber of hand edits.
    const again = generateFile(join(testDir, "agents", "helper.yaml"), undefined, true);
    expect(again.success).toBe(true);
    expect(readFileSync(join(testDir, "agents", "helper.ts"), "utf-8")).toBe(ts);
  });

  it("a name with a numeric segment yields files that validate and generate", async () => {
    await add("agent-2", "--type", "general", "--model", "gpt-4o");

    expect(validateFile(join(testDir, "agents", "agent-2.yaml")).errors).toEqual([]);
    expect(
      readFileSync(join(testDir, "agents", "agent-2.ts"), "utf-8"),
    ).toContain("export function agent2(");
    expect(
      readFileSync(join(testDir, "tests", "agent-2.test.ts"), "utf-8"),
    ).toContain('import { agent2 } from "../agents/agent-2";');
  });

  it("rejects a name that would become a reserved word", async () => {
    await expect(
      add("default", "--type", "typescript", "--model", "gpt-4o"),
    ).rejects.toThrow("process.exit(1)");
    expect(written("agents")).toBe(false);
  });

  it("--type on its own is enough: the model takes its default", async () => {
    await add("helper", "--type", "researcher");

    expect(
      readFileSync(join(testDir, "agents", "helper.yaml"), "utf-8"),
    ).toContain('model: "gpt-4o"');
  });

  it("rejects --yaml-only together with --ts-only", async () => {
    await expect(
      add("helper", "--type", "general", "--yaml-only", "--ts-only"),
    ).rejects.toThrow("process.exit(1)");
    expect(written("agents")).toBe(false);
  });

  it("writes no test file into a project that has no test runner", async () => {
    writeFileSync(join(testDir, "package.json"), JSON.stringify({ name: "tmp" }));

    await add("helper", "--type", "general", "--model", "gpt-4o");

    expect(written("agents", "helper.ts")).toBe(true);
    expect(written("tests", "helper.test.ts")).toBe(false);
  });

  it("a model id YAML would read as a number or boolean still validates", async () => {
    await add("helper", "--type", "general", "--model", "123");

    expect(validateFile(join(testDir, "agents", "helper.yaml")).errors).toEqual([]);
  });
});
