import { Command } from "commander";

// Export add command utilities for programmatic use
export {
  createAddCommand,
  generateAgentTest,
  generateAgentTypeScript,
  generateAgentYaml,
  kebabToCamel,
  validateAgentName,
} from "./commands/add.js";
// Export generate command for programmatic use
export {
  type GenerateResult,
  generateCommand,
  generateFile,
} from "./commands/generate.js";
// Export init command types and functions for programmatic use
export {
  createProject,
  initCommand,
  installDependencies,
  type PackageManager,
  type ProjectConfig,
  printSuccess,
  promptForConfig,
  type TypeScriptConfig,
} from "./commands/init.js";
// Export migrate command for programmatic use
export {
  autoFixIssues,
  detectMigrationIssues,
  generateMigrationReport,
  type MigrationIssue,
  migrateCommand,
} from "./commands/migrate.js";
// Export validate command for programmatic use
export {
  AGENT_SCHEMA,
  type FileValidationResult,
  type ValidationError,
  validateCommand,
  validateFile,
} from "./commands/validate.js";
// Export template utilities for programmatic use
export {
  type AgentType,
  getAgentTemplatePath,
  getDefaultVars,
  getProjectTemplatePath,
  getProjectTierFiles,
  getTemplatesRoot,
  loadAgentTemplate,
  loadProjectTemplate,
  type ProjectTier,
  processTemplate,
  type TemplateVars,
} from "./utils/templates.js";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("weft")
  .description("Weft CLI - AI Agent Development Toolkit")
  .version(version)
  .showHelpAfterError(true)
  .showSuggestionAfterError(true);

import { createAddCommand } from "./commands/add.js";
import { generateCommand } from "./commands/generate.js";
// Register commands
import { initCommand } from "./commands/init.js";
import { migrateCommand } from "./commands/migrate.js";
import { validateCommand } from "./commands/validate.js";

program.addCommand(initCommand());
program.addCommand(createAddCommand());
program.addCommand(validateCommand());
program.addCommand(migrateCommand());
program.addCommand(generateCommand());

// Handle unknown commands
program.on("command:*", (operands) => {
  console.error(`error: unknown command '${operands[0]}'`);
  console.error();
  program.outputHelp();
  process.exit(1);
});

program.parse();
