import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Subpath exports — must come before the root alias
      { find: "weft-core/solo", replacement: resolve(__dirname, "../weft-core/src/solo/index.ts") },
      { find: "weft-core/confidence", replacement: resolve(__dirname, "../weft-core/src/confidence/index.ts") },
      { find: "weft-core/coherence", replacement: resolve(__dirname, "../weft-core/src/coherence/index.ts") },
      { find: "weft-core/interview", replacement: resolve(__dirname, "../weft-core/src/interview/index.ts") },
      { find: "weft-core/change-kernel", replacement: resolve(__dirname, "../weft-core/src/change-kernel/index.ts") },
      { find: "weft-core/operators", replacement: resolve(__dirname, "../weft-core/src/operators/index.ts") },
      // Root alias — must be after all subpath aliases
      { find: "weft-core", replacement: resolve(__dirname, "../weft-core/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Format-valid test license so the module-level Pro gate (license-gate.ts)
    // loads under test the same way a licensed consumer runs it. Format-only
    // key (weft_pro_<40 hex>); no server/signature check exists yet.
    env: {
      // Synthesised format-valid mock (weft_pro_<40 hex>), not a real credential.
      WEFT_PRO_LICENSE_KEY: `weft_pro_${"deadbeef".repeat(5)}`,
    },
  },
});
