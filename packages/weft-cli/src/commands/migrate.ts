/**
 * `Weft migrate` command - scans codebase for zero-trust migration issues
 * Detects patterns affected by the zero-trust breaking change and provides
 * auto-fix for safe patterns.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";

// =============================================================================
// Types
// =============================================================================

/** Represents a migration issue found in the codebase */
export interface MigrationIssue {
  /** File path where the issue was found */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** The problematic code snippet */
  code: string;
  /** How to fix it */
  suggestion: string;
  /** Can be auto-fixed */
  autoFixable: boolean;
  /** Pattern that matched */
  patternId: string;
  /** Human-readable description of the issue */
  description?: string;
  /** Column offset for precise replacement (auto-fix only) */
  matchStart?: number;
  /** Match end position (auto-fix only) */
  matchEnd?: number;
}

/** Detection pattern definition */
interface DetectionPattern {
  id: string;
  pattern: RegExp;
  autoFixable: boolean;
  description: string;
  getSuggestion: (match: RegExpMatchArray, line: string) => string;
  /** Transform function for auto-fix */
  transform?: (match: RegExpMatchArray) => string;
}

// =============================================================================
// Detection Patterns (from 01.06 TrustModeMigrator)
// =============================================================================

const DETECTION_PATTERNS: DetectionPattern[] = [
  {
    id: "direct-property-then",
    pattern: /\.run\([^)]*\)\.then\(\s*\(?(\w+)\)?\s*=>\s*\1\.(?!value)(\w+)/g,
    autoFixable: true,
    description: "Direct property access in .then() callback",
    getSuggestion: (match) => {
      const varName = match[1];
      const propName = match[2];
      return `Change '.then(${varName} => ${varName}.${propName})' to '.then(${varName} => ${varName}.value.${propName})'`;
    },
    transform: (match) => {
      const varName = match[1];
      const propName = match[2];
      // Reconstruct the pattern with .value inserted
      return `.run(${match[0].match(/\.run\(([^)]*)\)/)?.[1] || ""}).then(${varName} => ${varName}.value.${propName}`;
    },
  },
  {
    id: "direct-property-access",
    pattern: /\.run\([^)]*\)\.then\(\s*\(?r\)?\s*=>\s*r\.(?!value)(\w+)/g,
    autoFixable: true,
    description: "Direct property access on run() result using 'r'",
    getSuggestion: (match) => {
      const propName = match[1];
      return `Change 'r.${propName}' to 'r.value.${propName}' - run() now returns TrackedResult`;
    },
    transform: (match) => {
      const propName = match[1];
      const runArgs = match[0].match(/\.run\(([^)]*)\)/)?.[1] || "";
      return `.run(${runArgs}).then(r => r.value.${propName}`;
    },
  },
  {
    id: "stored-result-access",
    pattern:
      /const\s+(\w+)\s*=\s*await[^;]*\.run\([^)]*\);\s*(?:[^}]*?\n)*?.*?\1\.(?!value)(?!confidence)(?!source)(\w+)/,
    autoFixable: false,
    description: "Property access on stored result variable",
    getSuggestion: (match) => {
      const varName = match[1];
      const propName = match[2];
      return `Variable '${varName}' is now TrackedResult. Access via '${varName}.value.${propName}'`;
    },
  },
  {
    id: "type-assertion-non-tracked",
    pattern: /\.run\([^)]*\)\s+as\s+(?!TrackedResult)(?!Promise)(\w+)/g,
    autoFixable: true,
    description: "Type assertion that doesn't account for TrackedResult",
    getSuggestion: (match) => {
      const typeName = match[1];
      return `Change 'as ${typeName}' to 'as TrackedResult<${typeName}>' - run() returns TrackedResult wrapper`;
    },
    transform: (match) => {
      const typeName = match[1];
      return `.run(${match[0].match(/\.run\(([^)]*)\)/)?.[1] || ""}) as TrackedResult<${typeName}>`;
    },
  },
  {
    id: "destructure-without-value",
    pattern:
      /const\s*\{\s*(?!value)(\w+)(?:\s*,\s*(?!value)\w+)*\s*\}\s*=\s*await[^;]*\.run\([^)]*\)/g,
    autoFixable: false,
    description: "Destructuring properties directly from run() result",
    getSuggestion: (match) => {
      const propName = match[1];
      return `Use 'const { value } = await ...run(ctx)' then destructure from value, or 'const { ${propName} } = (await ...run(ctx)).value'`;
    },
  },
  {
    id: "optional-chain-without-value",
    pattern: /\.run\([^)]*\)\s*\?\.\s*(?!value)(\w+)/g,
    autoFixable: true,
    description: "Optional chaining without .value",
    getSuggestion: (match) => {
      const propName = match[1];
      return `Change '?.${propName}' to '?.value?.${propName}' - run() returns TrackedResult`;
    },
    transform: (match) => {
      const propName = match[1];
      return `.run(${match[0].match(/\.run\(([^)]*)\)/)?.[1] || ""})?.value?.${propName}`;
    },
  },
];

// =============================================================================
// File System Utilities
// =============================================================================

const DEFAULT_EXCLUDES = [
  "node_modules",
  "dist",
  ".git",
  "_generated",
  "build",
];

/** Recursively finds TypeScript files in a directory */
async function findTypeScriptFiles(
  dir: string,
  exclude: string[] = DEFAULT_EXCLUDES,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (exclude.some((ex) => entry.name === ex || fullPath.includes(ex))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

/** Check if position is inside a comment */
function isInsideComment(content: string, position: number): boolean {
  const beforePosition = content.substring(0, position);
  const lastNewline = beforePosition.lastIndexOf("\n");
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
  const lineBeforeMatch = content.substring(lineStart, position);

  if (lineBeforeMatch.indexOf("//") !== -1) {
    return true;
  }

  let inMultilineComment = false;
  let i = 0;
  while (i < position) {
    if (content[i] === "/" && content[i + 1] === "*") {
      inMultilineComment = true;
      i += 2;
    } else if (content[i] === "*" && content[i + 1] === "/") {
      inMultilineComment = false;
      i += 2;
    } else {
      i++;
    }
  }

  return inMultilineComment;
}

// =============================================================================
// Detection Logic
// =============================================================================

/** Scan a single file for migration issues */
function scanFileForIssues(
  filePath: string,
  content: string,
  lines: string[],
): MigrationIssue[] {
  const issues: MigrationIssue[] = [];

  for (const patternDef of DETECTION_PATTERNS) {
    patternDef.pattern.lastIndex = 0;

    let match: RegExpExecArray | null = patternDef.pattern.exec(content);
    while (match !== null) {
      if (isInsideComment(content, match.index)) {
        match = patternDef.pattern.exec(content);
        continue;
      }

      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;
      const lineContent = lines[lineNumber - 1] || "";

      if (lineContent.includes(".value.")) {
        match = patternDef.pattern.exec(content);
        continue;
      }

      issues.push({
        file: filePath,
        line: lineNumber,
        code: lineContent.trim(),
        suggestion: patternDef.getSuggestion(match, lineContent),
        autoFixable: patternDef.autoFixable,
        patternId: patternDef.id,
        matchStart: match.index,
        matchEnd: match.index + match[0].length,
      });

      if (!patternDef.pattern.global) {
        break;
      }
      match = patternDef.pattern.exec(content);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.file}:${issue.line}:${issue.patternId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Detect migration issues in a project */
export async function detectMigrationIssues(
  projectPath: string,
): Promise<MigrationIssue[]> {
  const files = await findTypeScriptFiles(projectPath);
  const allIssues: MigrationIssue[] = [];

  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file, "utf-8");

      if (!content.includes(".run(")) {
        continue;
      }

      const lines = content.split("\n");
      const fileIssues = scanFileForIssues(file, content, lines);
      allIssues.push(...fileIssues);
    } catch {}
  }

  return allIssues.sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;
    return a.line - b.line;
  });
}

// =============================================================================
// Auto-Fix Logic
// =============================================================================

interface AutoFixResult {
  file: string;
  fixesApplied: number;
  originalContent: string;
  newContent: string;
}

/** Apply auto-fixes to a single file */
async function applyAutoFixes(
  filePath: string,
  issues: MigrationIssue[],
): Promise<AutoFixResult | null> {
  const autoFixableIssues = issues.filter((i) => i.autoFixable);
  if (autoFixableIssues.length === 0) return null;

  const content = await fs.promises.readFile(filePath, "utf-8");
  let newContent = content;
  let fixesApplied = 0;

  // Sort issues by position descending to avoid offset issues
  const sortedIssues = [...autoFixableIssues].sort(
    (a, b) => (b.matchStart || 0) - (a.matchStart || 0),
  );

  for (const issue of sortedIssues) {
    const pattern = DETECTION_PATTERNS.find((p) => p.id === issue.patternId);
    if (!pattern?.transform) continue;

    // Re-run pattern on current content to get fresh match
    pattern.pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.pattern.exec(newContent);
    while (match !== null) {
      // Check if this match is on the same line as the issue
      const beforeMatch = newContent.substring(0, match.index);
      const lineNumber = beforeMatch.split("\n").length;

      if (lineNumber === issue.line) {
        const replacement = pattern.transform(match);
        newContent =
          newContent.substring(0, match.index) +
          replacement +
          newContent.substring(match.index + match[0].length);
        fixesApplied++;
        break;
      }
      match = pattern.pattern.exec(newContent);
    }
  }

  if (fixesApplied === 0) return null;

  return {
    file: filePath,
    fixesApplied,
    originalContent: content,
    newContent,
  };
}

/** Apply auto-fixes to all files */
export async function autoFixIssues(
  issues: MigrationIssue[],
): Promise<{ filesModified: number; fixesApplied: number }> {
  const groupedByFile = issues.reduce(
    (acc, issue) => {
      if (!acc[issue.file]) acc[issue.file] = [];
      acc[issue.file].push(issue);
      return acc;
    },
    {} as Record<string, MigrationIssue[]>,
  );

  let filesModified = 0;
  let fixesApplied = 0;

  for (const [filePath, fileIssues] of Object.entries(groupedByFile)) {
    const result = await applyAutoFixes(filePath, fileIssues);
    if (result) {
      await fs.promises.writeFile(filePath, result.newContent, "utf-8");
      filesModified++;
      fixesApplied += result.fixesApplied;
    }
  }

  return { filesModified, fixesApplied };
}

// =============================================================================
// Report Generation
// =============================================================================

/** Generate markdown migration report */
export function generateMigrationReport(issues: MigrationIssue[]): string {
  const autoFixable = issues.filter((i) => i.autoFixable);
  const manualReview = issues.filter((i) => !i.autoFixable);

  const lines: string[] = [
    "# Zero-Trust Migration Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- **Total issues**: ${issues.length}`,
    `- **Auto-fixable**: ${autoFixable.length}`,
    `- **Manual review**: ${manualReview.length}`,
    "",
  ];

  if (issues.length === 0) {
    lines.push(
      "✅ **No migration issues found!** Your codebase is ready for zero-trust mode.",
      "",
    );
    return lines.join("\n");
  }

  if (autoFixable.length > 0) {
    lines.push("## Auto-Fixable Issues", "");
    lines.push("Run with `--auto-fix` to apply these automatically:", "");

    const grouped = groupByFile(autoFixable);
    for (const [file, fileIssues] of Object.entries(grouped)) {
      lines.push(`### \`${file}\``, "");
      for (const issue of fileIssues) {
        lines.push(
          `**Line ${issue.line}**: ${issue.description || issue.patternId}`,
        );
        lines.push("```typescript");
        lines.push(issue.code);
        lines.push("```");
        lines.push(`> 💡 ${issue.suggestion}`, "");
      }
    }
  }

  if (manualReview.length > 0) {
    lines.push("## Manual Review Required", "");
    lines.push("These patterns require manual review:", "");

    const grouped = groupByFile(manualReview);
    for (const [file, fileIssues] of Object.entries(grouped)) {
      lines.push(`### \`${file}\``, "");
      for (const issue of fileIssues) {
        lines.push(
          `**Line ${issue.line}**: ${issue.description || issue.patternId}`,
        );
        lines.push("```typescript");
        lines.push(issue.code);
        lines.push("```");
        lines.push(`> ⚠️ ${issue.suggestion}`, "");
      }
    }
  }

  lines.push("## Quick Migration Guide", "");
  lines.push(
    "If you need to migrate incrementally, use `trustMode: 'legacy'` temporarily:",
    "",
  );
  lines.push("```typescript");
  lines.push("// Temporary: returns raw value (legacy behavior)");
  lines.push("const result = await agent.run(ctx, { trustMode: 'legacy' });");
  lines.push("");
  lines.push("// Target: returns TrackedResult (zero-trust default)");
  lines.push("const tracked = await agent.run(ctx);");
  lines.push("const value = tracked.value; // Access via .value");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

function groupByFile(
  issues: MigrationIssue[],
): Record<string, MigrationIssue[]> {
  return issues.reduce(
    (acc, issue) => {
      if (!acc[issue.file]) acc[issue.file] = [];
      acc[issue.file].push(issue);
      return acc;
    },
    {} as Record<string, MigrationIssue[]>,
  );
}

// =============================================================================
// Console Output Formatting
// =============================================================================

/** Format console output for migration analysis */
function formatConsoleOutput(issues: MigrationIssue[]): void {
  const autoFixable = issues.filter((i) => i.autoFixable);
  const manualReview = issues.filter((i) => !i.autoFixable);

  console.log();
  console.log(chalk.bold.cyan("Zero-Trust Migration Analysis"));
  console.log();

  if (issues.length === 0) {
    console.log(chalk.green("✓ No migration issues found!"));
    console.log(chalk.dim("Your codebase is ready for zero-trust mode."));
    return;
  }

  console.log(
    `Found ${chalk.bold(issues.length)} issues ` +
      `(${chalk.green(autoFixable.length)} auto-fixable, ` +
      `${chalk.yellow(manualReview.length)} manual)`,
  );
  console.log();

  if (autoFixable.length > 0) {
    console.log(chalk.green.bold("Auto-Fixable:"));
    for (const issue of autoFixable) {
      const relativePath = path.relative(process.cwd(), issue.file);
      console.log(
        chalk.dim("  ") +
          chalk.white(`${relativePath}:${issue.line}`) +
          chalk.dim(` - ${issue.description || issue.patternId}`),
      );
    }
    console.log();
  }

  if (manualReview.length > 0) {
    console.log(chalk.yellow.bold("Manual Review Required:"));
    for (const issue of manualReview) {
      const relativePath = path.relative(process.cwd(), issue.file);
      console.log(
        chalk.dim("  ") +
          chalk.white(`${relativePath}:${issue.line}`) +
          chalk.dim(` - ${issue.description || issue.patternId}`),
      );
      console.log(chalk.cyan(`    → ${issue.suggestion}`));
    }
    console.log();
  }

  if (autoFixable.length > 0) {
    console.log(chalk.dim("Run with --auto-fix to apply safe fixes."));
  }
  console.log(chalk.dim("Run with --report to generate detailed report."));
}

// =============================================================================
// Command Definition
// =============================================================================

interface MigrateOptions {
  report?: boolean;
  autoFix?: boolean;
}

/**
 * Create the migrate command
 */
export function migrateCommand(): Command {
  const cmd = new Command("migrate")
    .description("Scan codebase for zero-trust migration issues")
    .argument("[path]", "Path to scan (default: current directory)", ".")
    .option("--report", "Generate migration-report.md file")
    .option("--auto-fix", "Apply safe automatic fixes")
    .action(async (targetPath: string, options: MigrateOptions) => {
      const resolvedPath = path.resolve(process.cwd(), targetPath);

      // Verify path exists
      if (!fs.existsSync(resolvedPath)) {
        console.error(chalk.red(`Error: Path does not exist: ${resolvedPath}`));
        process.exit(1);
      }

      const spinner = ora("Scanning for migration issues...").start();

      try {
        const issues = await detectMigrationIssues(resolvedPath);
        spinner.stop();

        // Handle auto-fix mode
        if (options.autoFix) {
          const autoFixable = issues.filter((i) => i.autoFixable);
          if (autoFixable.length === 0) {
            console.log(chalk.yellow("No auto-fixable issues found."));
          } else {
            const fixSpinner = ora("Applying auto-fixes...").start();
            const { filesModified, fixesApplied } = await autoFixIssues(issues);
            fixSpinner.succeed(
              chalk.green(
                `Applied ${fixesApplied} fixes across ${filesModified} files`,
              ),
            );

            // Re-scan to show remaining issues
            const remainingIssues = await detectMigrationIssues(resolvedPath);
            if (remainingIssues.length > 0) {
              console.log();
              console.log(
                chalk.yellow(
                  `${remainingIssues.length} issues remain (manual review required)`,
                ),
              );
              formatConsoleOutput(remainingIssues);
            } else {
              console.log(
                chalk.green(
                  "✓ All issues resolved! Ready for zero-trust mode.",
                ),
              );
            }
          }
          return;
        }

        // Handle report mode
        if (options.report) {
          const report = generateMigrationReport(issues);
          const reportPath = path.join(process.cwd(), "migration-report.md");
          await fs.promises.writeFile(reportPath, report, "utf-8");
          console.log(chalk.green(`✓ Report generated: ${reportPath}`));
          console.log();
          formatConsoleOutput(issues);
          return;
        }

        // Default: console output only
        formatConsoleOutput(issues);
      } catch (error) {
        spinner.fail(chalk.red("Failed to scan codebase"));
        console.error(
          chalk.red(error instanceof Error ? error.message : String(error)),
        );
        process.exit(1);
      }
    });

  return cmd;
}
