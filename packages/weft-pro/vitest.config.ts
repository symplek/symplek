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
  },
});
