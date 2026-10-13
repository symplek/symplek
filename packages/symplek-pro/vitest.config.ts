import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Subpath exports — must come before the root alias
      { find: "@symplek/core/solo", replacement: resolve(__dirname, "../symplek-core/src/solo/index.ts") },
      { find: "@symplek/core/confidence", replacement: resolve(__dirname, "../symplek-core/src/confidence/index.ts") },
      { find: "@symplek/core/coherence", replacement: resolve(__dirname, "../symplek-core/src/coherence/index.ts") },
      { find: "@symplek/core/interview", replacement: resolve(__dirname, "../symplek-core/src/interview/index.ts") },
      { find: "@symplek/core/change-kernel", replacement: resolve(__dirname, "../symplek-core/src/change-kernel/index.ts") },
      { find: "@symplek/core/operators", replacement: resolve(__dirname, "../symplek-core/src/operators/index.ts") },
      // Root alias — must be after all subpath aliases
      { find: "@symplek/core", replacement: resolve(__dirname, "../symplek-core/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Format-valid test license so the module-level Pro gate (license-gate.ts)
    // loads under test the same way a licensed consumer runs it. Format-only
    // key (symplek_pro_<40 hex>); no server/signature check exists yet.
    env: {
      // Synthesised format-valid mock (symplek_pro_<40 hex>), not a real credential.
      SYMPLEK_PRO_LICENSE_KEY: `symplek_pro_${"deadbeef".repeat(5)}`,
    },
  },
});
