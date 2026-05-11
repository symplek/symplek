/**
 * `Weft generate` command - generates TypeScript from YAML agent definitions
 * @description Converts YAML agent definitions to type-safe TypeScript code
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { watch } from "chokidar";
import { Command } from "commander";
import { glob } from "glob";
import yaml from "js-yaml";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (inline to avoid cross-package imports)
// ─────────────────────────────────────────────────────────────────────────────

type SupportedModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-3-opus"
  | "claude-3-sonnet"
  | "claude-3-haiku"
  | "gemini-2.0-flash"
  | "gemini-2.5-pro"
  | "gemini-3.1-flash-lite-preview";

interface ToolConfig {
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

type ToolReference = string | ToolConfig;

interface RetryOperatorConfig {
  maxAttempts?: number;
  backoffMs?: number;
}

interface TimeoutOperatorConfig {
  ms?: number;
  fallback?: string;
}

interface FallbackOperatorConfig {
  agent?: string;
  value?: unknown;
}

interface OperatorsConfig {
  retry?: RetryOperatorConfig;
  timeout?: TimeoutOperatorConfig;
  fallback?: FallbackOperatorConfig;
}

interface YamlAgentConfig {
  name: string;
  model: SupportedModel;
  systemPrompt: string;
  description?: string;
  version?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  tools?: ToolReference[];
  operators?: OperatorsConfig;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface ModelImportInfo {
  pkg: string;
  fn: string;
}

/** Result of generating a single file */
export interface GenerateResult {
  inputFile: string;
  outputFile: string;
  success: boolean;
  error?: string;
}

/** Command options */
interface GenerateOptions {
  watch?: boolean;
  output?: string;
  quiet?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL MAPPING
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_IMPORTS: Record<SupportedModel, ModelImportInfo> = {
  "gpt-4o": { pkg: "@ai-sdk/openai", fn: "openai" },
  "gpt-4o-mini": { pkg: "@ai-sdk/openai", fn: "openai" },
  "claude-3-opus": { pkg: "@ai-sdk/anthropic", fn: "anthropic" },
  "claude-3-sonnet": { pkg: "@ai-sdk/anthropic", fn: "anthropic" },
  "claude-3-haiku": { pkg: "@ai-sdk/anthropic", fn: "anthropic" },
  "gemini-2.0-flash": { pkg: "@ai-sdk/google", fn: "google" },
  "gemini-2.5-pro": { pkg: "@ai-sdk/google", fn: "google" },
  "gemini-3.1-flash-lite-preview": { pkg: "@ai-sdk/google", fn: "google" },
};

const SUPPORTED_MODELS: readonly SupportedModel[] = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-opus",
  "claude-3-sonnet",
  "claude-3-haiku",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite-preview",
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function isSupportedModel(value: string): value is SupportedModel {
  return SUPPORTED_MODELS.includes(value as SupportedModel);
}

function isToolConfig(tool: ToolReference): tool is ToolConfig {
  return typeof tool === "object" && "name" in tool;
}

function getModelImport(model: SupportedModel): ModelImportInfo {
  return MODEL_IMPORTS[model];
}

function escapeTemplate(str: string): string {
  return str.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Calculate output file path from input YAML path
 */
function getOutputPath(yamlPath: string, outputDir?: string): string {
  const baseName = path.basename(yamlPath, ".yaml");
  const dir = outputDir || path.dirname(yamlPath);
  return path.join(dir, `${baseName}.ts`);
}

// ─────────────────────────────────────────────────────────────────────────────
// YAML PARSER (inline for standalone CLI)
// ─────────────────────────────────────────────────────────────────────────────

interface ParseResult {
  config: YamlAgentConfig;
  errors: string[];
}

function parseYamlFile(filePath: string): ParseResult {
  const errors: string[] = [];

  const content = readFileSync(filePath, "utf-8");
  const parsed = yaml.load(content) as Record<string, unknown>;

  // Validate required fields
  if (!parsed.name || typeof parsed.name !== "string") {
    errors.push("Missing required field: name");
  }

  if (!parsed.model || typeof parsed.model !== "string") {
    errors.push("Missing required field: model");
  } else if (!isSupportedModel(parsed.model as string)) {
    errors.push(`Unsupported model: ${parsed.model}`);
  }

  if (!parsed.systemPrompt || typeof parsed.systemPrompt !== "string") {
    errors.push("Missing required field: systemPrompt");
  }

  // Validate name pattern
  if (parsed.name && !/^[a-z][a-z0-9-]*$/.test(parsed.name as string)) {
    errors.push(`Invalid agent name: ${parsed.name}. Use kebab-case.`);
  }

  const config: YamlAgentConfig = {
    name: (parsed.name as string) || "unknown",
    model: (parsed.model as SupportedModel) || "gpt-4o",
    systemPrompt: (parsed.systemPrompt as string) || "",
    description: parsed.description as string | undefined,
    version: parsed.version as string | undefined,
    temperature: parsed.temperature as number | undefined,
    maxTokens: parsed.maxTokens as number | undefined,
    timeout: parsed.timeout as number | undefined,
    tools: parsed.tools as ToolReference[] | undefined,
    operators: parsed.operators as OperatorsConfig | undefined,
    tags: parsed.tags as string[] | undefined,
    metadata: parsed.metadata as Record<string, unknown> | undefined,
  };

  return { config, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPESCRIPT GENERATOR (inline for standalone CLI)
// ─────────────────────────────────────────────────────────────────────────────

function generateTypeScript(
  config: YamlAgentConfig,
  sourceFile: string,
): string {
  const modelInfo = getModelImport(config.model);
  const exportName = toCamelCase(config.name);

  const lines: string[] = [];

  // Header
  lines.push(`// Generated from ${sourceFile}`);
  lines.push("// Do not edit directly - regenerate with: npx Weft generate");
  lines.push("");

  // Imports
  lines.push("import { AgentUnit } from '@weft/core';");
  lines.push(`import { ${modelInfo.fn} } from '${modelInfo.pkg}';`);

  // Tool import comments
  if (config.tools && config.tools.length > 0) {
    const toolNames = config.tools.map((tool) =>
      isToolConfig(tool) ? tool.name : tool,
    );
    lines.push(`// TODO: Import tools: ${toolNames.join(", ")}`);
  }

  lines.push("");

  // Agent definition
  lines.push(`export const ${exportName} = AgentUnit.create({`);
  lines.push(`  name: '${config.name}',`);
  lines.push(`  model: ${modelInfo.fn}('${config.model}'),`);

  // System prompt
  const escapedPrompt = escapeTemplate(config.systemPrompt);
  if (config.systemPrompt.includes("\n")) {
    lines.push(`  systemPrompt: \`${escapedPrompt}\`,`);
  } else {
    lines.push(`  systemPrompt: '${escapedPrompt.replace(/'/g, "\\'")}',`);
  }

  // Optional fields
  if (config.description !== undefined) {
    lines.push(`  description: '${config.description.replace(/'/g, "\\'")}',`);
  }

  if (config.temperature !== undefined) {
    lines.push(`  temperature: ${config.temperature},`);
  }

  if (config.maxTokens !== undefined) {
    lines.push(`  maxTokens: ${config.maxTokens},`);
  }

  if (config.timeout !== undefined) {
    lines.push(`  timeout: ${config.timeout},`);
  }

  // Tools comment
  if (config.tools && config.tools.length > 0) {
    const toolNames = config.tools.map((tool) =>
      isToolConfig(tool) ? tool.name : tool,
    );
    lines.push(`  // tools: [${toolNames.join(", ")}], // TODO: Wire up tools`);
  }

  lines.push("});");
  lines.push("");

  // Type export
  const typeName = `${toPascalCase(exportName)}Result`;
  lines.push(
    `export type ${typeName} = Awaited<ReturnType<typeof ${exportName}.run>>;`,
  );

  // Add operator-enhanced version if operators are configured
  if (config.operators) {
    const operatorChains: string[] = [];

    if (config.operators.retry) {
      const { maxAttempts = 3, backoffMs = 1000 } = config.operators.retry;
      operatorChains.push(`.retry(${maxAttempts}, ${backoffMs})`);
    }

    if (config.operators.timeout) {
      const { ms = 30000 } = config.operators.timeout;
      operatorChains.push(`.timeout(${ms})`);
    }

    if (config.operators.fallback) {
      if (config.operators.fallback.agent) {
        operatorChains.push(
          `.fallback(${toCamelCase(config.operators.fallback.agent)})`,
        );
      } else if (config.operators.fallback.value !== undefined) {
        operatorChains.push(
          `.fallback(${JSON.stringify(config.operators.fallback.value)})`,
        );
      }
    }

    if (operatorChains.length > 0) {
      const enhancedName = `${exportName}WithOperators`;
      lines.push("");
      lines.push("// Agent with operators configured");
      lines.push(`export const ${enhancedName} = ${exportName}`);
      for (const chain of operatorChains) {
        lines.push(`  ${chain}`);
      }
      lines.push(";");
      lines.push("");
      lines.push(
        `export type ${toPascalCase(enhancedName)}Result = Awaited<ReturnType<typeof ${enhancedName}.run>>;`,
      );
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate TypeScript for a single YAML file
 */
export function generateFile(
  inputPath: string,
  outputDir?: string,
  quiet = false,
): GenerateResult {
  const outputPath = getOutputPath(inputPath, outputDir);

  try {
    // Parse YAML
    const { config, errors } = parseYamlFile(inputPath);

    if (errors.length > 0) {
      return {
        inputFile: inputPath,
        outputFile: outputPath,
        success: false,
        error: errors.join("; "),
      };
    }

    // Generate TypeScript
    const typescript = generateTypeScript(config, inputPath);

    // Ensure output directory exists
    const outputDirPath = path.dirname(outputPath);
    if (!existsSync(outputDirPath)) {
      mkdirSync(outputDirPath, { recursive: true });
    }

    // Write file
    writeFileSync(outputPath, typescript, "utf-8");

    if (!quiet) {
      console.log(chalk.green(`✓ Generated ${outputPath}`));
    }

    return {
      inputFile: inputPath,
      outputFile: outputPath,
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      inputFile: inputPath,
      outputFile: outputPath,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Generate TypeScript for all matching YAML files
 */
async function generateAll(
  pattern: string,
  outputDir?: string,
  quiet = false,
): Promise<GenerateResult[]> {
  const files = await glob(pattern, {
    cwd: process.cwd(),
    nodir: true,
    absolute: false,
  });

  if (files.length === 0) {
    if (!quiet) {
      console.log(chalk.yellow(`No YAML files found matching: ${pattern}`));
    }
    return [];
  }

  const results: GenerateResult[] = [];

  for (const file of files) {
    const result = generateFile(file, outputDir, quiet);
    results.push(result);
  }

  return results;
}

/**
 * Print generation summary
 */
function printSummary(results: GenerateResult[], quiet: boolean): void {
  if (quiet) return;

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log();

  if (failed.length > 0) {
    for (const result of failed) {
      console.log(chalk.red(`✗ ${result.inputFile}: ${result.error}`));
    }
    console.log();
  }

  if (successful.length > 0) {
    console.log(
      chalk.green(
        `Generated ${successful.length} file${successful.length === 1 ? "" : "s"}`,
      ),
    );
  }

  if (failed.length > 0) {
    console.log(
      chalk.red(
        `Failed: ${failed.length} file${failed.length === 1 ? "" : "s"}`,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCH MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debounce function to prevent rapid regeneration
 */
function debounce(
  fn: (filePath: string) => void,
  ms: number,
): (filePath: string) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (filePath: string) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(filePath);
      timeoutId = null;
    }, ms);
  };
}

/**
 * Start watch mode for continuous generation
 */
function startWatchMode(
  pattern: string,
  outputDir?: string,
  quiet = false,
): void {
  if (!quiet) {
    console.log(chalk.cyan(`Watching for changes: ${pattern}`));
    console.log(chalk.dim("Press Ctrl+C to stop"));
    console.log();
  }

  const handleChange = debounce((filePath: string) => {
    if (!quiet) {
      console.log(chalk.dim(`Change detected: ${filePath}`));
    }
    generateFile(filePath, outputDir, quiet);
  }, 300);

  const handleAdd = (filePath: string) => {
    if (!quiet) {
      console.log(chalk.dim(`New file: ${filePath}`));
    }
    generateFile(filePath, outputDir, quiet);
  };

  const watcher = watch(pattern, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  watcher.on("add", handleAdd);
  watcher.on("change", handleChange);

  watcher.on("error", (error) => {
    console.error(chalk.red(`Watcher error: ${error.message}`));
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    if (!quiet) {
      console.log(chalk.dim("\nStopping watch mode..."));
    }
    watcher.close().then(() => {
      process.exit(0);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the generate command
 */
export function generateCommand(): Command {
  return new Command("generate")
    .description("Generate TypeScript from YAML agent definitions")
    .argument("[pattern]", "Glob pattern for YAML files", "agents/**/*.yaml")
    .option("-w, --watch", "Watch mode for continuous generation")
    .option("-o, --output <dir>", "Output directory (default: same as input)")
    .option("-q, --quiet", "Suppress output")
    .action(async (pattern: string, options: GenerateOptions) => {
      const { watch: watchMode = false, output, quiet = false } = options;

      if (watchMode) {
        // Watch mode - runs indefinitely
        startWatchMode(pattern, output, quiet);
      } else {
        // One-shot generation
        const results = await generateAll(pattern, output, quiet);

        printSummary(results, quiet);

        // Exit with appropriate code
        const hasFailures = results.some((r) => !r.success);
        process.exit(hasFailures ? 1 : 0);
      }
    });
}
