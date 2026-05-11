import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "weft-core/server",
        replacement: resolve(__dirname, "../weft-core/src/server.ts"),
      },
      {
        find: "weft-core",
        replacement: resolve(__dirname, "../weft-core/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
