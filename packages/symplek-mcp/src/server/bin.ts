/**
 * @module bin - @symplek/mcp binary entry point
 * @description Unconditional startup shim for the @symplek/mcp stdio server.
 *   This file is the sole entry point for the published binary. It contains
 *   no ESM-only guards (no `import.meta.url`) so it executes correctly in
 *   both CJS (the published `dist/bin.cjs`) and ESM contexts.
 *
 *   B9 fix: the previous entry guard `import.meta.url === file://...` is
 *   `undefined` in CommonJS, making the binary inert. This shim removes
 *   the guard entirely — execution of the binary IS the intent.
 * @runtime node
 * @surface binary
 */

import { startSymplekMcpServer } from "./index.js";

startSymplekMcpServer().catch((err: unknown) => {
  process.stderr.write(`[@symplek/mcp] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
