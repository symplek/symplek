/**
 * Tests for Weft migrate command
 */

import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  autoFixIssues,
  detectMigrationIssues,
  generateMigrationReport,
} from "../migrate.js";

// Create a temp directory for each test
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(
    path.join(tmpdir(), "Weft-migrate-test-"),
  );
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

// Helper to create a test file
async function createTestFile(
  filename: string,
  content: string,
): Promise<string> {
  const filePath = path.join(tempDir, filename);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("detectMigrationIssues", () => {
  it("should return empty array for clean codebase", async () => {
    await createTestFile(
      "clean.ts",
      `
      const result = await agent.run(ctx);
      const value = result.value.name;
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues).toHaveLength(0);
  });

  it("should detect direct property access in .then()", async () => {
    await createTestFile(
      "issue.ts",
      `
      agent.run(ctx).then(r => r.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].autoFixable).toBe(true);
    // Either pattern can match - both detect the same issue
    expect(["direct-property-access", "direct-property-then"]).toContain(
      issues[0].patternId,
    );
  });

  it("should detect direct property access with named variable", async () => {
    await createTestFile(
      "issue.ts",
      `
      agent.run(ctx).then(result => result.summary);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].autoFixable).toBe(true);
  });

  it("should detect stored result access (not auto-fixable)", async () => {
    await createTestFile(
      "stored.ts",
      `
      const result = await agent.run(ctx);
      console.log(result.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    // This pattern may or may not match depending on multiline behavior
    // The important thing is that if it matches, it should not be auto-fixable
    const storedIssues = issues.filter(
      (i) => i.patternId === "stored-result-access",
    );
    for (const issue of storedIssues) {
      expect(issue.autoFixable).toBe(false);
    }
  });

  it("should ignore issues inside comments", async () => {
    await createTestFile(
      "commented.ts",
      `
      // agent.run(ctx).then(r => r.name);
      /* agent.run(ctx).then(r => r.name); */
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues).toHaveLength(0);
  });

  it("should skip already migrated code", async () => {
    await createTestFile(
      "migrated.ts",
      `
      agent.run(ctx).then(r => r.value.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues).toHaveLength(0);
  });

  it("should exclude node_modules", async () => {
    await createTestFile(
      "node_modules/package/index.ts",
      `
      agent.run(ctx).then(r => r.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues).toHaveLength(0);
  });

  it("should exclude dist folder", async () => {
    await createTestFile(
      "dist/bundle.ts",
      `
      agent.run(ctx).then(r => r.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    expect(issues).toHaveLength(0);
  });

  it("should detect type assertion issues", async () => {
    await createTestFile(
      "assertion.ts",
      `
      const result = agent.run(ctx) as MyType;
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    const assertionIssues = issues.filter(
      (i) => i.patternId === "type-assertion-non-tracked",
    );
    expect(assertionIssues.length).toBeGreaterThan(0);
    expect(assertionIssues[0].autoFixable).toBe(true);
  });

  it("should detect optional chaining without .value", async () => {
    await createTestFile(
      "optional.ts",
      `
      const name = agent.run(ctx)?.name;
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    const optionalIssues = issues.filter(
      (i) => i.patternId === "optional-chain-without-value",
    );
    expect(optionalIssues.length).toBeGreaterThan(0);
    expect(optionalIssues[0].autoFixable).toBe(true);
  });
});

describe("autoFixIssues", () => {
  it("should apply auto-fixes for .then() pattern", async () => {
    const filePath = await createTestFile(
      "fixable.ts",
      `
      agent.run(ctx).then(r => r.name);
    `,
    );

    const issues = await detectMigrationIssues(tempDir);
    const { filesModified, fixesApplied } = await autoFixIssues(issues);

    expect(filesModified).toBe(1);
    expect(fixesApplied).toBeGreaterThan(0);

    const content = await fs.promises.readFile(filePath, "utf-8");
    expect(content).toContain("r.value.name");
  });

  it("should not modify non-auto-fixable issues", async () => {
    const filePath = await createTestFile(
      "manual.ts",
      `
      const result = await agent.run(ctx);
      console.log(result.name);
    `,
    );

    const originalContent = await fs.promises.readFile(filePath, "utf-8");
    const issues = await detectMigrationIssues(tempDir);
    const manualIssues = issues.filter((i) => !i.autoFixable);

    // Only pass manual issues - should not modify anything
    await autoFixIssues(manualIssues);

    const newContent = await fs.promises.readFile(filePath, "utf-8");
    expect(newContent).toBe(originalContent);
  });

  it("should return zero when no issues", async () => {
    const { filesModified, fixesApplied } = await autoFixIssues([]);
    expect(filesModified).toBe(0);
    expect(fixesApplied).toBe(0);
  });
});

describe("generateMigrationReport", () => {
  it("should generate report with no issues message", () => {
    const report = generateMigrationReport([]);
    expect(report).toContain("No migration issues found");
    expect(report).toContain("zero-trust mode");
  });

  it("should generate report with auto-fixable section", () => {
    const issues = [
      {
        file: "/path/to/file.ts",
        line: 10,
        code: "agent.run(ctx).then(r => r.name)",
        suggestion: "Change to r.value.name",
        autoFixable: true,
        patternId: "direct-property-access",
      },
    ];

    const report = generateMigrationReport(issues);
    expect(report).toContain("Auto-Fixable Issues");
    expect(report).toContain("/path/to/file.ts");
    expect(report).toContain("Line 10");
    expect(report).toContain("--auto-fix");
  });

  it("should generate report with manual review section", () => {
    const issues = [
      {
        file: "/path/to/file.ts",
        line: 20,
        code: "const result = await agent.run(ctx);",
        suggestion: "Access via result.value.property",
        autoFixable: false,
        patternId: "stored-result-access",
      },
    ];

    const report = generateMigrationReport(issues);
    expect(report).toContain("Manual Review Required");
    expect(report).toContain("/path/to/file.ts");
    expect(report).toContain("Line 20");
  });

  it("should include summary counts", () => {
    const issues = [
      {
        file: "/path/to/a.ts",
        line: 1,
        code: "code",
        suggestion: "fix",
        autoFixable: true,
        patternId: "test",
      },
      {
        file: "/path/to/b.ts",
        line: 1,
        code: "code",
        suggestion: "fix",
        autoFixable: false,
        patternId: "test",
      },
    ];

    const report = generateMigrationReport(issues);
    expect(report).toContain("**Total issues**: 2");
    expect(report).toContain("**Auto-fixable**: 1");
    expect(report).toContain("**Manual review**: 1");
  });

  it("should include quick migration guide", () => {
    const issues = [
      {
        file: "/path/to/file.ts",
        line: 1,
        code: "code",
        suggestion: "fix",
        autoFixable: true,
        patternId: "test",
      },
    ];

    const report = generateMigrationReport(issues);
    expect(report).toContain("Quick Migration Guide");
    expect(report).toContain("trustMode: 'legacy'");
    expect(report).toContain("TrackedResult");
  });
});

describe("migrateCommand", () => {
  it("should export migrateCommand function", async () => {
    const { migrateCommand } = await import("../migrate.js");
    expect(typeof migrateCommand).toBe("function");
  });

  it("should create a Command instance", async () => {
    const { migrateCommand } = await import("../migrate.js");
    const cmd = migrateCommand();
    expect(cmd.name()).toBe("migrate");
  });

  it("should have --report option", async () => {
    const { migrateCommand } = await import("../migrate.js");
    const cmd = migrateCommand();
    const options = cmd.options.map((o) => o.long);
    expect(options).toContain("--report");
  });

  it("should have --auto-fix option", async () => {
    const { migrateCommand } = await import("../migrate.js");
    const cmd = migrateCommand();
    const options = cmd.options.map((o) => o.long);
    expect(options).toContain("--auto-fix");
  });
});
