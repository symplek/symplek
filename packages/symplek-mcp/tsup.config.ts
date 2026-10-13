/**
 * @module tsup.config - @symplek/mcp build configuration
 * @description Separate entry configs allow a shebang banner on the binary
 *   output only. The bin entry is CJS-only (Node.js bin files run as CJS
 *   unless the package type is "module" and the file ends in .mjs).
 */

import { defineConfig } from "tsup";

export default defineConfig([
  // Library entries — CJS + ESM with declarations
  {
    entry: {
      index: "src/index.ts",
      server: "src/server/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    outDir: "dist",
    clean: true,
  },
  // Binary entry — CJS only, shebang banner so the file is directly executable
  {
    entry: {
      bin: "src/server/bin.ts",
    },
    format: ["cjs"],
    dts: false,
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
