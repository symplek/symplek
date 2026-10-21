#!/usr/bin/env node
/**
 * Build-time helper: copies `templates/` → `dist/templates/` so the
 * published tarball can load templates from `dist/templates/project/<tier>/`.
 *
 * The TypeScript build (tsc) only emits .ts → .js / .d.ts. Template files
 * (.template, .yaml, .json, .md) aren't transpiled, so they need a separate
 * copy step. We do it inline here instead of pulling in a generic copy
 * plugin — keeps @symplek/cli's build self-contained and dependency-free.
 *
 * Run: `node scripts/copy-templates.mjs` (or via the `build` npm script).
 */
import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const src = resolve(pkgRoot, "templates");
const dest = resolve(pkgRoot, "dist", "templates");

if (!existsSync(src) || !statSync(src).isDirectory()) {
  console.error(`[copy-templates] source missing or not a directory: ${src}`);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

cpSync(src, dest, { recursive: true });
console.log(`[copy-templates] ${src} → ${dest}`);
