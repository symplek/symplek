import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "weft-core": resolve(__dirname, "../weft-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
