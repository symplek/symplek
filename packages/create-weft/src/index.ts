#!/usr/bin/env node
/**
 * create-weft — thin `npm create` scaffolding wrapper.
 *
 * Delegates entirely to `weft-cli init`, forwarding every CLI argument
 * through untouched. Invoked as `npm create weft@latest [args]`, which npm
 * resolves to this `create-weft` bin.
 *
 * Carries no runtime dependencies of its own: it fetches and runs weft-cli
 * via `npx` so the scaffolder is always the latest published version.
 */

import { spawn } from "node:child_process";

// Everything after the binary name is forwarded verbatim to `weft init`.
const forwardedArgs = process.argv.slice(2);

const isWindows = process.platform === "win32";
const npxBin = isWindows ? "npx.cmd" : "npx";

// weft-cli exposes its CLI under the `weft` bin name, so resolve the package
// explicitly with `-p weft-cli` and run the `weft init` subcommand.
const npxArgs = ["--yes", "-p", "weft-cli", "weft", "init", ...forwardedArgs];

const child = spawn(npxBin, npxArgs, {
  stdio: "inherit",
  shell: isWindows,
});

child.on("error", (err) => {
  console.error("\ncreate-weft could not launch the Weft scaffolder.");
  console.error(`  Reason: ${err.message}`);
  console.error("\n  Check that Node.js and npm are installed, then retry:");
  console.error("    npm create weft@latest");
  console.error("\n  Or run the underlying CLI directly:");
  console.error("    npx -p weft-cli weft init\n");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // A signal kill (e.g. Ctrl-C) has no exit code — treat as failure.
  process.exit(signal ? 1 : (code ?? 0));
});
