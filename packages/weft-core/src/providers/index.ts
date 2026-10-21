/**
 * @fileoverview Providers entry point for @symplek/core
 *
 * Adapter files (anthropic.ts, openai.ts, google.ts) are NOT barrel-exported
 * here. Each adapter lazy-loads its SDK on first call (Contract 2). Barrel-
 * importing them would pull all three SDK imports into the module graph at
 * load time, defeating the lazy-load goal.
 *
 * Adapter factory functions are reached exclusively through facade.ts
 * _bootstrapProvider() via dynamic import().
 */

export * from "./auto";
export * from "./interface";
export * from "./registry";
