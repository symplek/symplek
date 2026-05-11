/**
 * Tests for template processing utilities
 */
import { describe, expect, it } from "vitest";
import {
  getAgentTemplatePath,
  getDefaultVars,
  getProjectTemplatePath,
  getProjectTierFiles,
  processTemplate,
} from "./templates.js";

describe("templates", () => {
  describe("processTemplate", () => {
    it("replaces single variable", () => {
      const template = "Hello, {{name}}!";
      const result = processTemplate(template, { name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("replaces multiple variables", () => {
      const template = "{{greeting}}, {{name}}!";
      const result = processTemplate(template, {
        greeting: "Hi",
        name: "Alice",
      });
      expect(result).toBe("Hi, Alice!");
    });

    it("preserves unmatched variables", () => {
      const template = "Hello, {{name}}! Version: {{version}}";
      const result = processTemplate(template, { name: "World" });
      expect(result).toBe("Hello, World! Version: {{version}}");
    });

    it("handles empty vars", () => {
      const template = "Hello, {{name}}!";
      const result = processTemplate(template, {});
      expect(result).toBe("Hello, {{name}}!");
    });

    it("handles template without variables", () => {
      const template = "Hello, World!";
      const result = processTemplate(template, { name: "Test" });
      expect(result).toBe("Hello, World!");
    });

    it("handles multiple occurrences of same variable", () => {
      const template = "{{name}} said: Hello, {{name}}!";
      const result = processTemplate(template, { name: "Alice" });
      expect(result).toBe("Alice said: Hello, Alice!");
    });

    it("handles JSON templates", () => {
      const template = `{
  "name": "{{name}}",
  "version": "{{version}}"
}`;
      const result = processTemplate(template, {
        name: "my-project",
        version: "1.0.0",
      });
      expect(result).toBe(`{
  "name": "my-project",
  "version": "1.0.0"
}`);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("handles multiline templates", () => {
      const template = `Line 1: {{var1}}
Line 2: {{var2}}
Line 3: {{var3}}`;
      const result = processTemplate(template, {
        var1: "A",
        var2: "B",
        var3: "C",
      });
      expect(result).toBe(`Line 1: A
Line 2: B
Line 3: C`);
    });
  });

  describe("getProjectTemplatePath", () => {
    it("returns path for minimal tier", () => {
      const path = getProjectTemplatePath("minimal", "package.json.template");
      expect(path).toContain("templates");
      expect(path).toContain("project");
      expect(path).toContain("minimal");
      expect(path).toContain("package.json.template");
    });

    it("returns path with nested segments", () => {
      const path = getProjectTemplatePath(
        "minimal",
        "src",
        "index.ts.template",
      );
      expect(path).toContain("src");
      expect(path).toContain("index.ts.template");
    });
  });

  describe("getAgentTemplatePath", () => {
    it("returns path for agent template", () => {
      const path = getAgentTemplatePath("general.yaml.template");
      expect(path).toContain("templates");
      expect(path).toContain("agent");
      expect(path).toContain("general.yaml.template");
    });
  });

  describe("getProjectTierFiles", () => {
    it("returns minimal tier files", () => {
      const files = getProjectTierFiles("minimal");
      expect(files).toContain("package.json.template");
      expect(files).toContain("tsconfig.json.template");
      expect(files).toContain("Weft.config.ts.template");
      expect(files).toContain("src/index.ts.template");
      expect(files).toContain("agents/example.yaml.template");
      expect(files.length).toBe(5);
    });

    it("standard tier includes minimal files", () => {
      const files = getProjectTierFiles("standard");
      expect(files).toContain("package.json.template");
      expect(files).toContain("src/tools/index.ts.template");
      expect(files).toContain("tests/example.test.ts.template");
      expect(files).toContain("README.md.template");
      expect(files.length).toBe(8);
    });

    it("full tier includes standard files", () => {
      const files = getProjectTierFiles("full");
      expect(files).toContain("package.json.template");
      expect(files).toContain("README.md.template");
      expect(files).toContain(".github/workflows/ci.yml.template");
      expect(files).toContain("Dockerfile.template");
      expect(files.length).toBe(10);
    });

    it("tiers are cumulative", () => {
      const minimal = getProjectTierFiles("minimal");
      const standard = getProjectTierFiles("standard");
      const full = getProjectTierFiles("full");

      // Each higher tier should include all files from lower tiers
      for (const file of minimal) {
        expect(standard).toContain(file);
        expect(full).toContain(file);
      }

      for (const file of standard) {
        expect(full).toContain(file);
      }
    });
  });

  describe("getDefaultVars", () => {
    it("returns default variables with name", () => {
      const vars = getDefaultVars("my-project");
      expect(vars.name).toBe("my-project");
      expect(vars.version).toBe("0.1.0");
      expect(vars.description).toContain("my-project");
      expect(vars.model).toBe("gpt-4o");
      expect(vars.agentName).toBe("example");
    });

    it("generates description from name", () => {
      const vars = getDefaultVars("awesome-agent");
      expect(vars.description).toBe("awesome-agent - Weft Agent Project");
    });
  });
});
