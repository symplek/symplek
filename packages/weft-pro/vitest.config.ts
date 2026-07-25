import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "weft-core": resolve(__dirname, "../weft-core/src/index.ts"),
      "weft-core/solo": resolve(__dirname, "../weft-core/src/solo/index.ts"),
      "weft-core/": resolve(__dirname, "../weft-core/src/"),
    },
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
