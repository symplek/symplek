// Library exports — no side effects. For CLI, import "weft-cli/cli" instead.
// ⚠️ FATAL #5 FIX (2026-07-07): CLI execution split into cli.ts.
// This file exports ONLY programmatic APIs. It does NOT call process.exit().
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
