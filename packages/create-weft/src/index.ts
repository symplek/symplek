#!/usr/bin/env node
/**
 * create-weft — thin `npm create` scaffolding wrapper.
 *
 * Delegates entirely to `weft-cli init`, forwarding every CLI argument
 * through untouched. Invoked as `npm create weft@latest [args]`, which npm
 * resolves to this `create-weft` bin.
 *
 * Carries no runtime dependencies of its own: it fetches weft-cli at the
 * same version via npx so the scaffolder matches this create package.
 */

import { spawn } from "node:child_process";

// Everything after the binary name is forwarded verbatim to `weft init`.
const forwardedArgs = process.argv.slice(2);

// Resolve weft-cli at the same version as this create-weft package
// to guarantee compatibility.
const weftVersion = require("../package.json").version;

const npxArgs = [
  "--yes",
  "-p",
  `weft-cli@${weftVersion}`,
  "weft",
  "init",
  ...forwardedArgs,
];

// spawn without shell to prevent command injection via untrusted CLI args.
const child = spawn("npx", npxArgs, {
  stdio: "inherit",
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
