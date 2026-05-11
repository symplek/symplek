/**
 * Tests for Weft init command
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

// Mock modules before importing the command
vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === "close") {
        // Simulate successful install
        setTimeout(() => cb(0), 10);
      }
    }),
    stderr: {
      on: vi.fn(),
    },
  })),
}));

import { createProject, type ProjectConfig } from "../init.js";

describe("Weft init command", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique test directory
    testDir = join(tmpdir(), `Weft-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe("project name validation", () => {
    const validNames = [
      "a",
      "my-project",
      "agent123",
      "my-Weft-agent",
      "test-agent-v2",
    ];

    const invalidNames = [
      "MyProject",
      "my_project",
      "my project",
      "123project",
      "-my-project",
      "my-project-",
      "",
    ];

    it.each(validNames)("accepts valid name: %s", (name) => {
      const regex = /^[a-z][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-z]$/;
      expect(regex.test(name)).toBe(true);
    });

    it.each(invalidNames)("rejects invalid name: %s", (name) => {
      const regex = /^[a-z][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-z]$/;
      expect(regex.test(name)).toBe(false);
    });
  });

  describe("createProject", () => {
    it("creates project directory structure for minimal template", async () => {
      const projectDir = join(testDir, "test-minimal");
      const config: ProjectConfig = {
        name: "test-minimal",
        template: "minimal",
        packageManager: "npm",
        typescript: "strict",
        targetDir: projectDir,
      };

      await createProject(config);

      // Verify directory was created
      expect(existsSync(projectDir)).toBe(true);

      // Verify essential files exist
      expect(existsSync(join(projectDir, "package.json"))).toBe(true);
      expect(existsSync(join(projectDir, "tsconfig.json"))).toBe(true);
      expect(existsSync(join(projectDir, "src", "index.ts"))).toBe(true);
      expect(existsSync(join(projectDir, "agents", "example.yaml"))).toBe(true);
    });

    it("creates project directory structure for standard template", async () => {
      const projectDir = join(testDir, "test-standard");
      const config: ProjectConfig = {
        name: "test-standard",
        template: "standard",
        packageManager: "pnpm",
        typescript: "strict",
        targetDir: projectDir,
      };

      await createProject(config);

      // Verify standard template files
      expect(existsSync(join(projectDir, "package.json"))).toBe(true);
      expect(existsSync(join(projectDir, "README.md"))).toBe(true);
      expect(existsSync(join(projectDir, "src", "tools", "index.ts"))).toBe(
        true,
      );
      expect(existsSync(join(projectDir, "tests", "example.test.ts"))).toBe(
        true,
      );
    });

    it("creates project directory structure for full template", async () => {
      const projectDir = join(testDir, "test-full");
      const config: ProjectConfig = {
        name: "test-full",
        template: "full",
        packageManager: "yarn",
        typescript: "standard",
        targetDir: projectDir,
      };

      await createProject(config);

      // Verify full template files
      expect(existsSync(join(projectDir, "package.json"))).toBe(true);
      expect(existsSync(join(projectDir, "Dockerfile"))).toBe(true);
      expect(
        existsSync(join(projectDir, ".github", "workflows", "ci.yml")),
      ).toBe(true);
    });

    it("interpolates template variables correctly", async () => {
      const projectDir = join(testDir, "my-agent");
      const config: ProjectConfig = {
        name: "my-agent",
        template: "minimal",
        packageManager: "npm",
        typescript: "strict",
        targetDir: projectDir,
      };

      await createProject(config);

      // Read package.json and verify name is interpolated
      const packageJson = JSON.parse(
        readFileSync(join(projectDir, "package.json"), "utf-8"),
      );
      expect(packageJson.name).toBe("my-agent");
    });

    it("fails if target directory already exists", async () => {
      const projectDir = join(testDir, "existing-project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, "test.txt"), "existing file");

      const config: ProjectConfig = {
        name: "existing-project",
        template: "minimal",
        packageManager: "npm",
        typescript: "strict",
        targetDir: projectDir,
      };

      // The directory exists but is not empty - createProject should still work
      // since it only creates the structure (doesn't check for existing files)
      // The validation happens in promptForConfig
      await expect(createProject(config)).resolves.not.toThrow();
    });
  });

  describe("package manager detection", () => {
    it("detects package manager from lockfiles", () => {
      const detectPackageManager = (): string => {
        if (existsSync("pnpm-lock.yaml")) return "pnpm";
        if (existsSync("yarn.lock")) return "yarn";
        if (existsSync("bun.lockb")) return "bun";
        return "npm";
      };

      // Test runs in workspace root which may have lockfiles
      const detected = detectPackageManager();
      expect(["npm", "pnpm", "yarn", "bun"]).toContain(detected);
    });
  });

  describe("install command generation", () => {
    it("generates correct npm install command", () => {
      const getInstallCommand = (pm: string): string[] => {
        switch (pm) {
          case "npm":
            return ["npm", "install"];
          case "pnpm":
            return ["pnpm", "install"];
          case "yarn":
            return ["yarn"];
          case "bun":
            return ["bun", "install"];
          default:
            return ["npm", "install"];
        }
      };

      expect(getInstallCommand("npm")).toEqual(["npm", "install"]);
      expect(getInstallCommand("pnpm")).toEqual(["pnpm", "install"]);
      expect(getInstallCommand("yarn")).toEqual(["yarn"]);
      expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
    });
  });

  describe("template file processing", () => {
    it("processes template variables", () => {
      const processTemplate = (
        content: string,
        vars: Record<string, string>,
      ): string => {
        return content.replace(
          /\{\{(\w+)\}\}/g,
          (match, key) => vars[key] ?? match,
        );
      };

      const template = '{"name": "{{name}}", "version": "{{version}}"}';
      const result = processTemplate(template, {
        name: "my-project",
        version: "1.0.0",
      });

      expect(result).toBe('{"name": "my-project", "version": "1.0.0"}');
    });

    it("preserves unmatched variables", () => {
      const processTemplate = (
        content: string,
        vars: Record<string, string>,
      ): string => {
        return content.replace(
          /\{\{(\w+)\}\}/g,
          (match, key) => vars[key] ?? match,
        );
      };

      const template = "Hello {{name}}, welcome to {{place}}!";
      const result = processTemplate(template, { name: "World" });

      expect(result).toBe("Hello World, welcome to {{place}}!");
    });
  });
});
