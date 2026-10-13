/**
 * @module round-trip — Template round-trip gate (B8)
 *
 * Every YAML template the CLI generates (project init, agent add) must pass
 * `validateFile` and then `generateFile` without errors. Failing here means a
 * user who follows the CLI's own instructions immediately hits a validation or
 * generation error on output the CLI produced.
 *
 * Design: render each template with the same variable substitution `init` and
 * `add` use, then run the real production validators/generators against the
 * rendered string. No mocks; the test exercises the shipped code.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateFile } from "../generate.js";
import { validateFile } from "../validate.js";
import {
  getDefaultVars,
  getProjectTemplatePath,
  processTemplate,
} from "../../utils/templates.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderProjectYaml(tier: "minimal" | "standard" | "full"): string {
  const vars = { ...getDefaultVars("my-project"), model: "gpt-4o" };
  const templatePath = getProjectTemplatePath(
    tier,
    "agents",
    "example.yaml.template",
  );
  const raw = readFileSync(templatePath, "utf-8");
  return processTemplate(raw, vars);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("template round-trip (B8) — every scaffolded YAML passes validate and generate", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "weft-round-trip-"));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ── Project templates ──────────────────────────────────────────────────────

  for (const tier of ["minimal", "standard", "full"] as const) {
    it(`project/${tier}: example.yaml passes validate`, () => {
      const yaml = renderProjectYaml(tier);
      const filePath = join(testDir, `${tier}-example.yaml`);
      writeFileSync(filePath, yaml, "utf-8");

      const result = validateFile(filePath);

      expect(
        result.errors.map((e) => `${e.line}: ${e.message}`),
        `${tier} template should produce zero validate errors`,
      ).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`project/${tier}: example.yaml generates TypeScript`, () => {
      const yaml = renderProjectYaml(tier);
      const filePath = join(testDir, `${tier}-example.yaml`);
      writeFileSync(filePath, yaml, "utf-8");

      const result = generateFile(filePath, undefined, true);

      expect(result.error, `${tier} template should generate without error`).toBeUndefined();
      expect(result.success).toBe(true);
    });
  }

  // ── Agent templates ────────────────────────────────────────────────────────
  // Import generateAgentYaml so the test exercises the same code path as
  // `weft add agent`, not a hand-built YAML string.

  describe("agent templates pass validate", () => {
    for (const agentType of ["general", "researcher", "reviewer", "custom"] as const) {
      it(`add agent --type ${agentType} output passes validate`, async () => {
        // Dynamic import to avoid a static import of add.ts at module-load time
        // (add.ts imports inquirer which may error if stdin is not a TTY).
        const { generateAgentYaml } = await import("../add.js");

        const yaml = generateAgentYaml(`test-${agentType}`, {
          type: agentType,
          model: "gpt-4o",
        });

        const filePath = join(testDir, `${agentType}.yaml`);
        writeFileSync(filePath, yaml, "utf-8");

        const result = validateFile(filePath);

        expect(
          result.errors.map((e) => `${e.line}: ${e.message}`),
          `agent template --type ${agentType} should produce zero validate errors`,
        ).toEqual([]);
        expect(result.valid).toBe(true);
      });
    }
  });

  // ── Agent names ────────────────────────────────────────────────────────────
  // validate and generate share one name rule. A name validate passes and
  // generate then refuses sends the user round in a circle.

  describe("validate and generate agree on agent names", () => {
    const writeAgent = (name: string): string => {
      const filePath = join(testDir, "named.yaml");
      writeFileSync(
        filePath,
        `name: ${name}\nmodel: "gpt-4o"\nsystemPrompt: You are a test agent.\n`,
        "utf-8",
      );
      return filePath;
    };

    for (const name of ["agent-", "my--agent", "-agent"]) {
      it(`both refuse ${JSON.stringify(name)}`, () => {
        const filePath = writeAgent(name);

        expect(validateFile(filePath).valid).toBe(false);
        expect(generateFile(filePath, undefined, true).success).toBe(false);
      });
    }

    for (const name of ["agent", "my-agent", "agent-2"]) {
      it(`both accept ${JSON.stringify(name)}`, () => {
        const filePath = writeAgent(name);

        expect(validateFile(filePath).errors).toEqual([]);
        expect(generateFile(filePath, undefined, true).success).toBe(true);
      });
    }
  });
});
