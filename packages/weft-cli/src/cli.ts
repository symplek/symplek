#!/usr/bin/env node
/**
 * @fileoverview CLI entry point for weft-cli.
 * @description This file IS the executable (`bin` in package.json).
 *   It calls program.parse() — it should NEVER be imported as a library.
 *
 * ⚠️ CRITICAL: This file calls process.exit(). Do NOT import it.
 *   For programmatic use, import from "weft-cli" which provides only
 *   the library exports (no side effects, no process.exit).
 *
 * @module weft-cli/cli
 * @since 1.0.0-beta.2 — Split from index.ts (FATAL #5 fix, 2026-07-07)
 */
import { Command } from "commander";

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
