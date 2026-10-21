#!/usr/bin/env node
/**
 * create-symplek — thin `npm create` scaffolding wrapper.
 *
 * Delegates entirely to `@symplek/cli init`, forwarding every CLI argument
 * through untouched. Invoked as `npm create symplek@latest [args]`, which npm
 * resolves to this `create-symplek` bin.
 *
 * Carries no runtime dependencies of its own: it fetches @symplek/cli at the
 * same version via npx so the scaffolder matches this create package.
 */

import { spawn } from "node:child_process";

// Everything after the binary name is forwarded verbatim to `symplek init`.
const forwardedArgs = process.argv.slice(2);

// Resolve @symplek/cli at the same version as this create-symplek package.
// Version parity is enforced at release time: create-symplek and @symplek/cli
// are in the same Changesets linked group (.changeset/config.json), so
// every release publishes both packages at the same version.  The npx
// call below is therefore guaranteed to find @symplek/cli@<this version>
// on the registry — the two packages cannot drift independently.
const symplekVersion = require("../package.json").version;

const npxArgs = [
  "--yes",
  "-p",
  `@symplek/cli@${symplekVersion}`,
  "symplek",
  "init",
  ...forwardedArgs,
];

// On Windows, npx resolves to `npx.cmd` which requires shell: true.
// On POSIX, shell: false is safer (prevents injection via untrusted args).
const child = spawn("npx", npxArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  console.error("\ncreate-symplek could not launch the Symplek scaffolder.");
  console.error(`  Reason: ${err.message}`);
  console.error("\n  Check that Node.js and npm are installed, then retry:");
  console.error("    npm create symplek@latest");
  console.error("\n  Or run the underlying CLI directly:");
  console.error("    npx -p @symplek/cli symplek init\n");
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // A signal kill (e.g. Ctrl-C) has no exit code — treat as failure.
  process.exit(signal ? 1 : (code ?? 0));
});
