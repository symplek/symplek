/**
 * `symplek generate` command - generates TypeScript from YAML agent definitions
 * @description Converts YAML agent definitions to type-safe TypeScript code
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { watch } from "chokidar";
import { Command } from "commander";
import { glob } from "glob";
import yaml from "js-yaml";
import { DEFAULT_MODEL, isModelId, MODEL_ID_HINT } from "../models.js";
import { isReservedWord, KEBAB_CASE_REGEX, kebabToCamel } from "../naming.js";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ToolConfig {
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

type ToolReference = string | ToolConfig;

// Field name matches @symplek/core's RetryOptions.baseDelayMs so generated code is correct.
interface RetryOperatorConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
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
  model: string;
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
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function isToolConfig(tool: ToolReference): tool is ToolConfig {
  return typeof tool === "object" && "name" in tool;
}

/** First characters of every file this command writes. */
const GENERATED_HEADER = "// Generated from";

/**
 * True when a file is at `filePath` and this command did not write it. Such a
 * file is somebody's work, so nothing here may replace it.
 */
export function isHandWritten(filePath: string): boolean {
  return (
    existsSync(filePath) &&
    !readFileSync(filePath, "utf-8").startsWith(GENERATED_HEADER)
  );
}

function toPascalCase(str: string): string {
  const camel = kebabToCamel(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE EMITTERS — defend the generated code against injection from the
// YAML source.
//
// Every value that crosses from YAML into the emitted TypeScript MUST pass
// through one of these helpers. The previous `'${field}'` style template
// interpolation was unsafe: a YAML name like `x'); evil(); //` produced
// runnable malicious TS.
// ─────────────────────────────────────────────────────────────────────────────

/** Valid JavaScript identifier (used for exported symbols and function refs). */
const JS_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Emit a string value as a safe JS string literal. JSON.stringify produces
 * a double-quoted JS string with all needed escapes (quotes, backslashes,
 * newlines, unicode, etc.) — strictly safer than hand-rolled quoting.
 */
function emitString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Emit a number as a JS numeric literal. Rejects non-finite values to
 * prevent `NaN`/`Infinity` literals and to catch type-shape drift early.
 */
function emitNumber(value: number, field: string): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `Field "${field}" must be a finite number; got ${String(value)}`,
    );
  }
  return JSON.stringify(value);
}

/**
 * Validate a string is a safe JavaScript identifier and return it
 * unchanged. Throws on any character outside `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`.
 * Use this for every value that's emitted UNQUOTED into the generated TS
 * (export names, function-name references, type names).
 */
function emitIdentifier(value: string, field: string): string {
  if (!JS_IDENTIFIER_RE.test(value)) {
    throw new Error(
      `Field "${field}" is not a valid JavaScript identifier: "${value}"`,
    );
  }
  if (isReservedWord(value)) {
    throw new Error(
      `Field "${field}" is a JavaScript reserved word and cannot name an export: "${value}"`,
    );
  }
  return value;
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
  } else if (!isModelId(parsed.model)) {
    errors.push(`Invalid model id: ${parsed.model}. ${MODEL_ID_HINT}`);
  }

  if (!parsed.systemPrompt || typeof parsed.systemPrompt !== "string") {
    errors.push("Missing required field: systemPrompt");
  }

  // Validate name pattern
  if (parsed.name && !KEBAB_CASE_REGEX.test(parsed.name as string)) {
    errors.push(`Invalid agent name: ${parsed.name}. Use kebab-case.`);
  }

  // Validate version is semver-ish if present
  if (parsed.version !== undefined && typeof parsed.version !== "string") {
    errors.push(`version must be a string, got ${typeof parsed.version}`);
  }

  // Validate tags are strings if present
  if (parsed.tags !== undefined) {
    if (!Array.isArray(parsed.tags)) {
      errors.push("tags must be an array of strings");
    } else {
      for (const tag of parsed.tags as unknown[]) {
        if (typeof tag !== "string") {
          errors.push(`tag must be a string, got ${typeof tag}`);
        }
      }
    }
  }

  const config: YamlAgentConfig = {
    name: (parsed.name as string) || "unknown",
    model: (parsed.model as string) || DEFAULT_MODEL,
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
  const exportName = kebabToCamel(config.name);
  const lines: string[] = [];

  // Validate identifiers up-front so failures surface before any code is emitted.
  const safeExportName = emitIdentifier(exportName, "exportName");

  // Collect extra import lines required by operators (e.g. fallback agent).
  const extraImports: string[] = [];

  // Build ai() options object fields.
  const aiOptions: string[] = [];
  aiOptions.push(`    model: ${emitString(config.model)},`);
  aiOptions.push(`    system: ${emitString(config.systemPrompt)},`);

  if (config.temperature !== undefined) {
    aiOptions.push(
      `    temperature: ${emitNumber(config.temperature, "temperature")},`,
    );
  }

  if (config.maxTokens !== undefined) {
    aiOptions.push(
      `    maxTokens: ${emitNumber(config.maxTokens, "maxTokens")},`,
    );
  }

  if (config.timeout !== undefined) {
    // timeout is a top-level YAML field; wire through the ai() options object.
    aiOptions.push(
      `    timeout: ${emitNumber(config.timeout, "timeout")},`,
    );
  }

  // Tool stubs comment — tool integration requires custom wiring; emit a
  // reminder so the developer knows what to add, but no speculative code.
  if (config.tools && config.tools.length > 0) {
    const toolNames = config.tools.map((tool) =>
      isToolConfig(tool) ? tool.name : tool,
    );
    aiOptions.push(
      `    // TODO: wire tools: ${toolNames.map((n) => emitString(n)).join(", ")}`,
    );
  }

  // Resolve operator chains — must happen before header emit so we can
  // collect extraImports that need to appear at the top of the file.
  const operatorChains: string[] = [];
  let enhancedName = "";

  if (config.operators) {
    if (config.operators.retry) {
      const { maxAttempts = 3, baseDelayMs = 1000 } = config.operators.retry;
      operatorChains.push(
        `.retry(${emitNumber(maxAttempts, "operators.retry.maxAttempts")}, { baseDelayMs: ${emitNumber(baseDelayMs, "operators.retry.baseDelayMs")} })`,
      );
    }

    if (config.operators.timeout) {
      const { ms = 30000 } = config.operators.timeout;
      operatorChains.push(
        `.timeout(${emitNumber(ms, "operators.timeout.ms")})`,
      );
    }

    if (config.operators.fallback) {
      if (config.operators.fallback.agent) {
        // .fallback() takes an AgentUnit<T>, not a factory function.
        // We call the fallback factory with the same prompt so the caller's
        // intent (retry with a different model) is preserved.
        const fallbackModule = config.operators.fallback.agent;
        const fallbackAgent = emitIdentifier(
          kebabToCamel(fallbackModule),
          "operators.fallback.agent",
        );
        // Import the fallback agent from its module (assumed same directory).
        extraImports.push(
          `import { ${fallbackAgent} } from "./${fallbackModule}";`,
        );
        // Pass prompt to the fallback factory so it returns an AgentUnit<string>.
        operatorChains.push(`.fallback(${fallbackAgent}(prompt))`);
      } else if (config.operators.fallback.value !== undefined) {
        operatorChains.push(
          `.orElse(${JSON.stringify(config.operators.fallback.value)})`,
        );
      }
    }

    if (operatorChains.length > 0) {
      enhancedName = emitIdentifier(
        `${safeExportName}WithOperators`,
        "enhancedName",
      );
    }
  }

  // ── Emit ───────────────────────────────────────────────────────────────────

  // Header
  lines.push(`${GENERATED_HEADER} ${emitString(sourceFile)}`);
  lines.push("// Do not edit directly - regenerate with: symplek generate");
  lines.push("");
  // Imports: AgentUnit from the public @symplek/core root; ai() from the server
  // subpath (requires "@symplek/core" in the consuming project's dependencies).
  lines.push('import { AgentUnit } from "@symplek/core";');
  lines.push('import { ai } from "@symplek/core/server";');
  for (const imp of extraImports) {
    lines.push(imp);
  }
  lines.push("");

  if (config.description !== undefined) {
    // The description lands inside a block comment. JSON escaping leaves
    // `*/` intact, which would end the comment and turn the rest of the
    // description into code, so the closing sequence is broken up.
    const description = emitString(config.description)
      .slice(1, -1)
      .replace(/\*\//g, "*\\/");
    lines.push(`/** ${description} */`);
  }

  // The agent is a factory function that binds the static config (model,
  // system prompt, etc.) and defers the runtime prompt to the caller.
  // Using AgentUnit.from — the correct factory for async computations.
  lines.push(
    `export function ${safeExportName}(prompt: string): AgentUnit<string> {`,
  );
  lines.push("  return AgentUnit.from((_ctx) =>");
  lines.push("    ai(prompt, {");
  for (const opt of aiOptions) {
    lines.push(`  ${opt}`);
  }
  lines.push("    }),");
  lines.push("  );");
  lines.push("}");
  lines.push("");

  // Type alias — ReturnType of the function (an AgentUnit), then of its .run().
  const typeName = emitIdentifier(
    `${toPascalCase(safeExportName)}Result`,
    "typeName",
  );
  lines.push(
    `export type ${typeName} = Awaited<ReturnType<ReturnType<typeof ${safeExportName}>["run"]>>;`,
  );

  // Add operator-enhanced variant if operators are configured in the YAML.
  if (enhancedName && operatorChains.length > 0) {
    lines.push("");
    lines.push("/** Agent with operators from YAML operators block. */");
    lines.push(
      `export function ${enhancedName}(prompt: string): AgentUnit<string> {`,
    );
    lines.push(`  return ${safeExportName}(prompt)`);
    for (const chain of operatorChains) {
      lines.push(`    ${chain}`);
    }
    lines.push("    ;");
    lines.push("}");
    lines.push("");
    const enhancedTypeName = emitIdentifier(
      `${toPascalCase(enhancedName)}Result`,
      "enhancedTypeName",
    );
    lines.push(
      `export type ${enhancedTypeName} = Awaited<ReturnType<ReturnType<typeof ${enhancedName}>["run"]>>;`,
    );
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

    // The output sits next to the YAML under the same name, where a
    // hand-written agent could already be.
    if (isHandWritten(outputPath)) {
      return {
        inputFile: inputPath,
        outputFile: outputPath,
        success: false,
        error: `${outputPath} already exists and was not generated by this command. Move or delete it, or pass --output to write somewhere else.`,
      };
    }

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
