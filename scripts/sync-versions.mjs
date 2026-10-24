#!/usr/bin/env node
/**
 * Keeps each package's `src/version.ts` equal to the version in its
 * package.json.
 *
 * A package that reports its own version at runtime (in an error prefix, an
 * MCP handshake, an exported constant) keeps it in `src/version.ts` as
 * `export const VERSION = "..."`. `changeset version` bumps package.json only,
 * so this runs straight after it (see the root `version-packages` script) and
 * the version pull request carries both.
 *
 *   node scripts/sync-versions.mjs           rewrite any constant that is behind
 *   node scripts/sync-versions.mjs --check   exit 1 if any constant is behind
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const CONSTANT = /(export const VERSION\s*=\s*")([^"]*)"/;

const stale = [];
for (const dir of readdirSync(path.join(repo, "packages"))) {
  const manifest = path.join(repo, "packages", dir, "package.json");
  const file = path.join(repo, "packages", dir, "src", "version.ts");
  if (!existsSync(manifest) || !existsSync(file)) continue;

  const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
  const source = readFileSync(file, "utf8");
  const match = source.match(CONSTANT);
  if (!match) {
    console.error(`sync-versions: ${name}: src/version.ts has no \`export const VERSION = "..."\` line`);
    process.exit(1);
  }
  if (match[2] === version) continue;

  stale.push(`${name}: src/version.ts says ${match[2]}, package.json says ${version}`);
  // A function, not a "$1..." string: a version starts with a digit, and
  // "$1" followed by a digit reads as a two-digit group reference.
  if (!check) writeFileSync(file, source.replace(CONSTANT, (_, prefix) => `${prefix}${version}"`));
}

if (stale.length === 0) {
  console.log("sync-versions: every version constant matches its package.json");
} else if (check) {
  console.error(`sync-versions: ${stale.length} version constant(s) out of date\n${stale.map((s) => `  - ${s}`).join("\n")}\nRun: node scripts/sync-versions.mjs`);
  process.exit(1);
} else {
  console.log(`sync-versions: updated\n${stale.map((s) => `  - ${s}`).join("\n")}`);
}
