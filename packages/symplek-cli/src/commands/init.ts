/**
 * Symplek init command - scaffolds new Symplek projects
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import ora from "ora";
import {
  getDefaultVars,
  getProjectTemplatePath,
  type ProjectTier,
  processTemplate,
  type TemplateVars,
} from "../utils/templates.js";

/** Package manager options */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** TypeScript configuration level */
export type TypeScriptConfig = "strict" | "standard";

/** Project configuration */
export interface ProjectConfig {
  name: string;
  template: ProjectTier;
  packageManager: PackageManager;
  typescript: TypeScriptConfig;
  targetDir: string;
}

/** Command line options from commander */
interface CommandOptions {
  name?: string;
  template?: ProjectTier;
  pm?: PackageManager;
  yes?: boolean;
}

/** Validate project name is kebab-case (lowercase start, alphanumeric/hyphen body) */
function isValidProjectName(name: string): boolean {
  return /^[a-z][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(name) || /^[a-z]$/.test(name);
}

/** Detect package manager from lockfiles in current directory */
function detectPackageManager(): PackageManager {
  if (existsSync("pnpm-lock.yaml")) return "pnpm";
  if (existsSync("yarn.lock")) return "yarn";
  if (existsSync("bun.lockb")) return "bun";
  return "npm";
}

/** Get install command for package manager */
function getInstallCommand(pm: PackageManager): string[] {
  switch (pm) {
    case "npm":
      return ["npm", "install"];
    case "pnpm":
      return ["pnpm", "install"];
    case "yarn":
      return ["yarn"];
    case "bun":
      return ["bun", "install"];
  }
}

/**
 * Get project name from options or prompt
 */
async function getProjectName(options: CommandOptions): Promise<string> {
  if (options.name) {
    if (!isValidProjectName(options.name)) {
      console.error(chalk.red(`Invalid project name: ${options.name}`));
      console.error(
        chalk.yellow("Project name must be kebab-case (e.g., my-agent)"),
      );
      process.exit(1);
    }
    return options.name;
  }

  if (options.yes) {
    return "my-symplek-project";
  }

  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Project name:",
      default: "my-symplek-project",
      validate: (input: string) => {
        if (!input.trim()) {
          return "Project name is required";
        }
        if (!isValidProjectName(input)) {
          return "Project name must be kebab-case (e.g., my-agent)";
        }
        if (existsSync(input)) {
          return `Directory "${input}" already exists`;
        }
        return true;
      },
    },
  ]);
  return name;
}

/**
 * Get template from options or prompt
 */
async function getTemplate(options: CommandOptions): Promise<ProjectTier> {
  if (options.template) {
    if (!["minimal", "standard", "full"].includes(options.template)) {
      console.error(chalk.red(`Invalid template: ${options.template}`));
      console.error(chalk.yellow("Valid templates: minimal, standard, full"));
      process.exit(1);
    }
    return options.template;
  }

  if (options.yes) {
    return "standard";
  }

  const { template } = await inquirer.prompt([
    {
      type: "list",
      name: "template",
      message: "Select project template:",
      choices: [
        {
          name: "minimal - Basic setup with core dependencies",
          value: "minimal",
        },
        {
          name: "standard - Includes tools, tests, and README",
          value: "standard",
        },
        {
          name: "full - Complete setup with CI/CD and Docker",
          value: "full",
        },
      ],
      default: "standard",
    },
  ]);
  return template;
}

/**
 * Get package manager from options or prompt
 */
async function getPackageManager(
  options: CommandOptions,
): Promise<PackageManager> {
  if (options.pm) {
    if (!["npm", "pnpm", "yarn", "bun"].includes(options.pm)) {
      console.error(chalk.red(`Invalid package manager: ${options.pm}`));
      console.error(chalk.yellow("Valid options: npm, pnpm, yarn, bun"));
      process.exit(1);
    }
    return options.pm;
  }

  if (options.yes) {
    return detectPackageManager();
  }

  const detected = detectPackageManager();
  const { packageManager } = await inquirer.prompt([
    {
      type: "list",
      name: "packageManager",
      message: "Select package manager:",
      choices: [
        { name: "npm", value: "npm" },
        { name: "pnpm (recommended)", value: "pnpm" },
        { name: "yarn", value: "yarn" },
        { name: "bun", value: "bun" },
      ],
      default: detected,
    },
  ]);
  return packageManager;
}

/**
 * Get TypeScript config from options or prompt
 */
async function getTypeScriptConfig(
  options: CommandOptions,
): Promise<TypeScriptConfig> {
  if (options.yes) {
    return "strict";
  }

  const { typescript } = await inquirer.prompt([
    {
      type: "list",
      name: "typescript",
      message: "TypeScript configuration:",
      choices: [
        {
          name: "strict - Recommended for new projects",
          value: "strict",
        },
        {
          name: "standard - More lenient settings",
          value: "standard",
        },
      ],
      default: "strict",
    },
  ]);
  return typescript;
}

/**
 * Prompt user for project configuration
 */
export async function promptForConfig(
  options: CommandOptions,
): Promise<ProjectConfig> {
  // Get project name
  const name = await getProjectName(options);

  // Check if directory exists
  if (existsSync(name)) {
    console.error(chalk.red(`Directory "${name}" already exists`));
    process.exit(1);
  }

  // Get remaining config
  const template = await getTemplate(options);
  const packageManager = await getPackageManager(options);
  const typescript = await getTypeScriptConfig(options);

  return {
    name,
    template,
    packageManager,
    typescript,
    targetDir: join(process.cwd(), name),
  };
}

/**
 * Recursively copy template files to target directory
 */
function copyTemplateDir(
  templateDir: string,
  targetDir: string,
  vars: TemplateVars,
): void {
  const entries = readdirSync(templateDir);

  for (const entry of entries) {
    const srcPath = join(templateDir, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const destDir = join(targetDir, entry);
      mkdirSync(destDir, { recursive: true });
      copyTemplateDir(srcPath, destDir, vars);
    } else if (entry.endsWith(".template")) {
      // Remove .template extension and process content
      const destPath = join(targetDir, entry.replace(".template", ""));
      const content = readFileSync(srcPath, "utf-8");
      const processed = processTemplate(content, vars);

      // Ensure parent directory exists
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, processed, "utf-8");
    }
  }
}

/**
 * Create project from template
 */
export async function createProject(config: ProjectConfig): Promise<void> {
  const spinner = ora("Creating project files...").start();

  try {
    // Create target directory
    mkdirSync(config.targetDir, { recursive: true });

    // Get template variables
    const vars: TemplateVars = {
      ...getDefaultVars(config.name),
      strict: config.typescript === "strict" ? "true" : "false",
    };

    // Get template path and copy files
    const templatePath = getProjectTemplatePath(config.template);
    copyTemplateDir(templatePath, config.targetDir, vars);

    spinner.succeed(chalk.green("Project files created"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to create project files"));
    throw error;
  }
}

/**
 * Install project dependencies
 */
export async function installDependencies(
  packageManager: PackageManager,
  targetDir: string,
): Promise<void> {
  const spinner = ora(
    `Installing dependencies with ${packageManager}...`,
  ).start();

  return new Promise((resolve, reject) => {
    const [cmd, ...args] = getInstallCommand(packageManager);

    const child = spawn(cmd, args, {
      cwd: targetDir,
      stdio: "pipe",
      shell: process.platform === "win32",
    });

    let stderr = "";

    // Drain stdout — without a consumer the pipe buffer fills on verbose installs
    // and blocks the "close" event, hanging the CLI indefinitely (N59).
    child.stdout?.on("data", () => {
      /* intentionally discarded */
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        spinner.succeed(chalk.green("Dependencies installed"));
        resolve();
      } else {
        spinner.fail(chalk.red("Failed to install dependencies"));
        if (stderr) {
          console.error(chalk.dim(stderr));
        }
        reject(new Error(`${packageManager} install failed with code ${code}`));
      }
    });

    child.on("error", (error) => {
      spinner.fail(chalk.red("Failed to install dependencies"));
      reject(error);
    });
  });
}

/**
 * Print success message with next steps
 */
export function printSuccess(config: ProjectConfig): void {
  console.log();
  console.log(
    chalk.green.bold("✓ ") +
      chalk.bold(`Project "${config.name}" created successfully!`),
  );
  console.log();
  console.log(chalk.bold("Next steps:"));
  console.log();
  console.log(chalk.cyan(`  cd ${config.name}`));

  const runCmd =
    config.packageManager === "npm" ? "npm run" : config.packageManager;
  console.log(chalk.cyan(`  ${runCmd} dev`));
  console.log();
  console.log(chalk.dim("Useful commands:"));
  console.log(chalk.dim(`  ${runCmd} build     Build your agents`));
  console.log(chalk.dim(`  ${runCmd} test      Run tests`));
  console.log(chalk.dim(`  symplek add agent    Add a new agent`));
  console.log();
  console.log(
    chalk.dim("Documentation: ") +
      chalk.blue.underline("https://symplek.dev/docs"),
  );
  console.log();
}

/**
 * Create the init command
 */
export function initCommand(): Command {
  const cmd = new Command("init")
    .description("Initialize a new Symplek project")
    .option("-n, --name <name>", "Project name (kebab-case)")
    .option(
      "-t, --template <template>",
      "Template: minimal, standard, full",
      "standard",
    )
    .option("-p, --pm <pm>", "Package manager: npm, pnpm, yarn, bun")
    .option("-y, --yes", "Skip prompts and use defaults")
    .action(async (options: CommandOptions) => {
      console.log();
      console.log(chalk.bold.blue("🚀 Symplek Project Initializer"));
      console.log();

      try {
        // Gather configuration
        const config = await promptForConfig(options);

        // Create project
        await createProject(config);

        // Install dependencies
        await installDependencies(config.packageManager, config.targetDir);

        // Print success
        printSuccess(config);
      } catch (error) {
        console.error();
        console.error(
          chalk.red("Error: ") +
            (error instanceof Error ? error.message : String(error)),
        );
        process.exit(1);
      }
    });

  return cmd;
}
