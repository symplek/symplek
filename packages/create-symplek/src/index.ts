#!/usr/bin/env node
/**
 * create-symplek: the `npm create` wrapper around `symplek init`.
 *
 * Runs the @symplek/cli installed alongside this package (an ordinary dependency,
 * released at the same version) and hands every argument through to
 * `symplek init`. The CLI's entry file is started with the running Node binary:
 * no shell, no second download, and the same behaviour on every platform.
 */

import { spawn } from "node:child_process";

const cliEntry = require.resolve("@symplek/cli/bin/symplek.js");

const child = spawn(
  process.execPath,
  [cliEntry, "init", ...process.argv.slice(2)],
  { stdio: "inherit" },
);

child.on("error", (err) => {
  console.error("\ncreate-symplek could not start the Symplek scaffolder.");
  console.error(`  Reason: ${err.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // A signal kill (e.g. Ctrl-C) has no exit code: treat it as failure.
  process.exit(signal ? 1 : (code ?? 0));
});
