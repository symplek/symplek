/**
 * @file test-dist.mjs — dist import smoke test for @symplek/harness
 *
 * Verifies that every exports-map entry in package.json loads cleanly from the
 * built dist/ directory. Run AFTER `pnpm build` via `pnpm test:dist`.
 *
 * This file gates the B13 fix: it WILL fail with "Cannot find module ... dist/adapter/claude-agent-sdk"
 * if the build emits imports without .js extensions (NodeNext moduleResolution absent).
 *
 * Usage:
 *   pnpm --filter @symplek/harness build && pnpm --filter @symplek/harness test:dist
 */

import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function checkEntry(label, relPath) {
  const fullPath = join(__dirname, relPath);
  const url = new URL(`file://${fullPath.replace(/\\/g, "/")}`);
  const mod = await import(url.href);
  const keys = Object.keys(mod);
  if (keys.length === 0) throw new Error(`${label}: no exports`);
  console.log(`OK  ${label}  [${keys.slice(0, 5).join(", ")}${keys.length > 5 ? "…" : ""}]`);
}

const entries = [
  ["root (dist/index.js)", "dist/index.js"],
  ["replay (dist/replay/index.js)", "dist/replay/index.js"],
  ["react (dist/react/useHarnessProgress.js)", "dist/react/useHarnessProgress.js"],
];

let failed = false;
for (const [label, path] of entries) {
  try {
    await checkEntry(label, path);
  } catch (err) {
    console.error(`FAIL ${label}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("\nAll dist entries load cleanly.");
}
