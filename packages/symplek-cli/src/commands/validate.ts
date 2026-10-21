/**
 * `Symplek validate` command - validates YAML agent definitions
 * @description Validates YAML files against the Symplek agent schema with line-number error reporting
 */

import { existsSync, readFileSync } from "node:fs";
import Ajv, { type ErrorObject } from "ajv";
import chalk from "chalk";
import { Command } from "commander";
import { glob } from "glob";
import yaml, { type YAMLException } from "js-yaml";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA (inline to avoid cross-package imports)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["name", "model", "systemPrompt"],
  properties: {
    name: {
      type: "string",
      pattern: "^[a-z][a-z0-9-]*$",
    },
    model: {
      type: "string",
      enum: [
        "gpt-4o",
        "gpt-4o-mini",
        "claude-3-opus",
        "claude-3-sonnet",
        "claude-3-haiku",
        "gemini-3.1-flash-lite-preview",
        "gemini-1.5-pro",
      ],
    },
    systemPrompt: {
      type: "string",
      minLength: 1,
    },
    description: { type: "string" },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 2,
    },
    maxTokens: {
      type: "integer",
      minimum: 1,
      maximum: 128000,
    },
    timeout: {
      type: "integer",
      minimum: 1000,
      maximum: 300000,
    },
    retries: {
      type: "object",
      properties: {
        maxAttempts: { type: "integer", minimum: 1, maximum: 10 },
        backoffMs: { type: "integer", minimum: 100, maximum: 60000 },
        backoffMultiplier: { type: "number", minimum: 1, maximum: 5 },
      },
      additionalProperties: false,
    },
    tools: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              enabled: { type: "boolean" },
              config: { type: "object", additionalProperties: true },
            },
            additionalProperties: false,
          },
        ],
      },
    },
    tracking: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        defaultSource: {
          type: "string",
          enum: ["agent", "user", "tool", "verified", "synthesized"],
        },
        defaultConfidence: { type: "number", minimum: 0, maximum: 1 },
        requireVerification: { type: "boolean" },
      },
      additionalProperties: false,
    },
    operators: {
      type: "object",
      properties: {
        retry: {
          type: "object",
          properties: {
            maxAttempts: { type: "integer", minimum: 1, maximum: 10 },
            backoffMs: { type: "integer", minimum: 100 },
          },
          additionalProperties: false,
        },
        timeout: {
          type: "object",
          properties: {
            ms: { type: "integer", minimum: 1000 },
            fallback: { type: "string" },
          },
          additionalProperties: false,
        },
        fallback: {
          type: "object",
          properties: {
            agent: { type: "string" },
            value: {},
          },
          additionalProperties: false,
        },
        challenge: {
          type: "object",
          properties: {
            challenger: { type: "string" },
            minConfidence: { type: "number", minimum: 0, maximum: 1 },
          },
          additionalProperties: false,
        },
        consensus: {
          type: "object",
          properties: {
            agents: { type: "array", items: { type: "string" } },
            quorum: { type: "number", minimum: 0.5, maximum: 1 },
            weights: {
              type: "object",
              additionalProperties: { type: "number" },
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    memory: {
      type: "object",
      properties: {
        episodic: { type: "boolean" },
        semantic: { type: "boolean" },
        procedural: { type: "boolean" },
        maxEpisodes: { type: "integer", minimum: 1 },
        maxFacts: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    tags: { type: "array", items: { type: "string" } },
    metadata: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Validation error with location information */
export interface ValidationError {
  file: string;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
}

/** Result of validating a single file */
export interface FileValidationResult {
  file: string;
  valid: boolean;
  errors: ValidationError[];
}

/** Command options */
interface ValidateOptions {
  quiet?: boolean;
  strict?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// AJV SETUP
// ─────────────────────────────────────────────────────────────────────────────

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false,
});

const validateSchema = ajv.compile(AGENT_SCHEMA);

// ─────────────────────────────────────────────────────────────────────────────
// ERROR FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

/** Format an AJV error into a human-readable message */
function formatAjvError(error: ErrorObject): string {
  switch (error.keyword) {
    case "required": {
      const params = error.params as { missingProperty: string };
      return `Missing required field: '${params.missingProperty}'`;
    }
    case "enum": {
      const params = error.params as { allowedValues: string[] };
      return `Invalid value. Allowed: ${params.allowedValues.join(", ")}`;
    }
    case "type": {
      const params = error.params as { type: string };
      return `Type mismatch: expected ${params.type}`;
    }
    case "pattern": {
      return "Invalid format";
    }
    case "minimum": {
      const params = error.params as { limit: number };
      return `Value too low: minimum is ${params.limit}`;
    }
    case "maximum": {
      const params = error.params as { limit: number };
      return `Value too high: maximum is ${params.limit}`;
    }
    case "minLength": {
      const params = error.params as { limit: number };
      return `Value too short: minimum length is ${params.limit}`;
    }
    case "additionalProperties": {
      const params = error.params as { additionalProperty: string };
      return `Unknown field: '${params.additionalProperty}'`;
    }
    default:
      return error.message || "Validation error";
  }
}

/** Get a fix suggestion for common validation errors */
function getSuggestion(error: ErrorObject): string | undefined {
  const instancePath = error.instancePath || "";

  switch (error.keyword) {
    case "required": {
      const params = error.params as { missingProperty: string };
      const field = params.missingProperty;
      if (field === "name") return "Add 'name' field like: name: my-agent";
      if (field === "model")
        return "Add 'model' field like: model: claude-3-sonnet";
      if (field === "systemPrompt")
        return "Add 'systemPrompt' field with your agent instructions";
      return `Add the required '${field}' field`;
    }
    case "enum": {
      if (instancePath.endsWith("/model")) {
        return "Use one of: gpt-4o, gpt-4o-mini, claude-3-opus, claude-3-sonnet, claude-3-haiku, gemini-2.0-flash, gemini-1.5-pro";
      }
      if (instancePath.includes("/defaultSource")) {
        return "Use one of: agent, user, tool, verified, synthesized";
      }
      return undefined;
    }
    case "pattern": {
      if (instancePath.endsWith("/name")) {
        return "Use kebab-case: lowercase letters, numbers, and hyphens (e.g., my-agent-v2)";
      }
      if (instancePath.endsWith("/version")) {
        return "Use semantic versioning: X.Y.Z (e.g., 1.0.0)";
      }
      return undefined;
    }
    case "additionalProperties": {
      const params = error.params as { additionalProperty: string };
      return `Remove unknown field '${params.additionalProperty}' or check for typos`;
    }
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE NUMBER TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/** Build a map of YAML field paths to line numbers */
function buildLineMap(content: string): Map<string, number> {
  const lineMap = new Map<string, number>();
  const lines = content.split("\n");
  const pathStack: Array<{ indent: number; key: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (!line.trim() || line.trim().startsWith("#")) continue;

    const keyMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*):/);
    if (keyMatch) {
      const indent = keyMatch[1].length;
      const key = keyMatch[2];

      while (
        pathStack.length > 0 &&
        pathStack[pathStack.length - 1].indent >= indent
      ) {
        pathStack.pop();
      }

      const path =
        pathStack.length > 0
          ? `${pathStack.map((p) => p.key).join(".")}.${key}`
          : key;

      lineMap.set(path, lineNum);
      pathStack.push({ indent, key });
    }
  }

  return lineMap;
}

/** Convert AJV instancePath to dot notation */
function instancePathToFieldPath(instancePath: string): string {
  if (!instancePath || instancePath === "/") return "";
  return instancePath.slice(1).replace(/\//g, ".");
}

/** Get line number for an error from the lineMap */
function getLineNumber(
  lineMap: Map<string, number>,
  instancePath: string,
  error: ErrorObject,
): number {
  if (error.keyword === "required") {
    const params = error.params as { missingProperty: string };
    const basePath = instancePathToFieldPath(instancePath);
    const fullPath = basePath
      ? `${basePath}.${params.missingProperty}`
      : params.missingProperty;

    const line = lineMap.get(fullPath);
    if (line !== undefined) return line;

    if (basePath) {
      const parentLine = lineMap.get(basePath);
      if (parentLine !== undefined) return parentLine;
    }

    return 1;
  }

  const fieldPath = instancePathToFieldPath(instancePath);
  const directLine = lineMap.get(fieldPath);
  if (directLine !== undefined) return directLine;

  const parts = fieldPath.split(".");
  while (parts.length > 0) {
    parts.pop();
    const parentPath = parts.join(".");
    const parentLine = lineMap.get(parentPath);
    if (parentLine !== undefined) return parentLine;
  }

  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/** Validate a single YAML file */
export function validateFile(filePath: string): FileValidationResult {
  const errors: ValidationError[] = [];

  // Check file exists
  if (!existsSync(filePath)) {
    return {
      file: filePath,
      valid: false,
      errors: [
        {
          file: filePath,
          line: 0,
          column: 0,
          message: "File not found",
        },
      ],
    };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return {
      file: filePath,
      valid: false,
      errors: [
        {
          file: filePath,
          line: 0,
          column: 0,
          message: `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  // Build line map for error location
  const lineMap = buildLineMap(content);

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(content, { filename: filePath });
  } catch (err) {
    if (err instanceof Error && "mark" in err) {
      const yamlError = err as YAMLException;
      errors.push({
        file: filePath,
        line: yamlError.mark ? yamlError.mark.line + 1 : 1,
        column: yamlError.mark ? yamlError.mark.column + 1 : 1,
        message: yamlError.message,
        suggestion: "Check YAML syntax - ensure proper indentation and quoting",
      });
    } else {
      errors.push({
        file: filePath,
        line: 1,
        column: 1,
        message: err instanceof Error ? err.message : "YAML parse error",
        suggestion: "Check YAML syntax is valid",
      });
    }
    return { file: filePath, valid: false, errors };
  }

  // Check it's an object
  if (typeof parsed !== "object" || parsed === null) {
    errors.push({
      file: filePath,
      line: 1,
      column: 1,
      message: "YAML must be an object at root level",
      suggestion: "Ensure the YAML file contains key-value pairs, not a scalar",
    });
    return { file: filePath, valid: false, errors };
  }

  // Validate against schema
  const isValid = validateSchema(parsed);

  if (!isValid && validateSchema.errors) {
    for (const error of validateSchema.errors) {
      const line = getLineNumber(lineMap, error.instancePath, error);
      errors.push({
        file: filePath,
        line,
        column: 1,
        message: formatAjvError(error),
        suggestion: getSuggestion(error),
      });
    }
  }

  return {
    file: filePath,
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

/** Format a validation error for console output */
function formatError(error: ValidationError): string {
  const location = `${error.file}:${error.line}:${error.column}`;
  let output = chalk.red(`${location} - ${error.message}`);
  if (error.suggestion) {
    output += `\n  ${chalk.yellow("→")} ${chalk.dim(error.suggestion)}`;
  }
  return output;
}

/** Print validation summary */
function printSummary(
  errorCount: number,
  errorFileCount: number,
  validCount: number,
  quiet: boolean,
): void {
  if (quiet) return;

  console.log();

  if (errorCount > 0) {
    const fileWord = errorFileCount === 1 ? "file" : "files";
    console.log(
      chalk.red(
        `✗ ${errorCount} error${errorCount === 1 ? "" : "s"} in ${errorFileCount} ${fileWord}`,
      ),
    );
  }

  if (validCount > 0) {
    console.log(
      chalk.green(`✓ ${validCount} file${validCount === 1 ? "" : "s"} valid`),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the validate command
 */
export function validateCommand(): Command {
  return new Command("validate")
    .description("Validate YAML agent definitions against the schema")
    .argument("[pattern]", "Glob pattern for YAML files", "agents/**/*.yaml")
    .option("-q, --quiet", "Suppress output (just exit code)")
    .option("-s, --strict", "Fail on warnings too")
    .action(async (pattern: string, options: ValidateOptions) => {
      const { quiet = false } = options;

      // Find files matching pattern
      const files = await glob(pattern, {
        cwd: process.cwd(),
        nodir: true,
        absolute: false,
      });

      if (files.length === 0) {
        if (!quiet) {
          console.log(
            chalk.yellow(`No YAML files found matching pattern: ${pattern}`),
          );
        }
        process.exit(0);
      }

      // Validate each file
      const results: FileValidationResult[] = [];
      for (const file of files) {
        results.push(validateFile(file));
      }

      // Count results
      const validFiles = results.filter((r) => r.valid);
      const invalidFiles = results.filter((r) => !r.valid);
      const totalErrors = invalidFiles.reduce(
        (sum, r) => sum + r.errors.length,
        0,
      );

      // Print errors
      if (!quiet) {
        for (const result of invalidFiles) {
          for (const error of result.errors) {
            console.log(formatError(error));
            console.log();
          }
        }
      }

      // Print summary
      printSummary(totalErrors, invalidFiles.length, validFiles.length, quiet);

      // Exit with appropriate code
      process.exit(invalidFiles.length > 0 ? 1 : 0);
    });
}

// Export for programmatic use
export { AGENT_SCHEMA };
