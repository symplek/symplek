/**
 * Template processing utilities for Weft CLI
 * Handles variable interpolation and template loading
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Available project template tiers */
export type ProjectTier = "minimal" | "standard" | "full";

/** Available agent template types */
export type AgentType = "general" | "researcher" | "reviewer" | "typescript";

/** Template variable map */
export type TemplateVars = Record<string, string>;

/**
 * Process a template string by replacing {{variableName}} with actual values
 * Unmatched variables are preserved as-is
 */
export function processTemplate(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match);
}

/**
 * Resolve the templates root, handling both build and source layouts:
 *
 *   - Built CLI (dist/utils/templates.js): `../templates` → `dist/templates/`,
 *     populated by `scripts/copy-templates.mjs` at build time.
 *   - Source-time / tests (src/utils/templates.ts): `../templates` would
 *     point at the deleted `src/templates/`. Walk one level higher to
 *     find the package-root `templates/` directory directly.
 */
function resolveTemplatesRoot(): string {
  const dist = resolve(__dirname, "..", "templates");
  if (existsSync(dist)) return dist;
  const src = resolve(__dirname, "..", "..", "templates");
  return src;
}

/**
 * Get the absolute path to a project template file
 */
export function getProjectTemplatePath(
  tier: ProjectTier,
  ...pathSegments: string[]
): string {
  return join(resolveTemplatesRoot(), "project", tier, ...pathSegments);
}

/**
 * Get the absolute path to an agent template file
 */
export function getAgentTemplatePath(filename: string): string {
  return join(resolveTemplatesRoot(), "agent", filename);
}

/**
 * Load a project template file and process it with variables
 */
export function loadProjectTemplate(
  tier: ProjectTier,
  pathSegments: string[],
  vars: TemplateVars = {},
): string {
  const templatePath = getProjectTemplatePath(tier, ...pathSegments);

  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const content = readFileSync(templatePath, "utf-8");
  return processTemplate(content, vars);
}

/**
 * Load an agent template file and process it with variables
 */
export function loadAgentTemplate(
  type: AgentType,
  vars: TemplateVars = {},
): string {
  const filename =
    type === "typescript" ? "agent.ts.template" : `${type}.yaml.template`;
  const templatePath = getAgentTemplatePath(filename);

  if (!existsSync(templatePath)) {
    throw new Error(`Agent template not found: ${templatePath}`);
  }

  const content = readFileSync(templatePath, "utf-8");
  return processTemplate(content, vars);
}

/**
 * Get the templates root directory path
 */
export function getTemplatesRoot(): string {
  return resolveTemplatesRoot();
}

/**
 * Get list of files for a project tier
 * Higher tiers inherit from lower tiers
 */
export function getProjectTierFiles(tier: ProjectTier): string[] {
  const minimalFiles = [
    "package.json.template",
    "tsconfig.json.template",
    "src/weft.config.ts.template",
    "src/index.ts.template",
    "agents/example.yaml.template",
  ];

  const standardFiles = [
    ...minimalFiles,
    "src/tools/index.ts.template",
    "tests/example.test.ts.template",
    "README.md.template",
  ];

  const fullFiles = [
    ...standardFiles,
    ".github/workflows/ci.yml.template",
    "Dockerfile.template",
  ];

  switch (tier) {
    case "minimal":
      return minimalFiles;
    case "standard":
      return standardFiles;
    case "full":
      return fullFiles;
  }
}

/**
 * Default template variables with sensible defaults
 */
export function getDefaultVars(name: string): TemplateVars {
  return {
    name,
    version: "0.1.0",
    description: `${name} - Weft Agent Project`,
    author: "",
    model: "gpt-4o",
    agentName: "example",
  };
}
