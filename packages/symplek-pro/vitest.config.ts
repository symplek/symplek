import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@symplek/core": resolve(__dirname, "../symplek-core/src/index.ts"),
      "@symplek/core/solo": resolve(__dirname, "../symplek-core/src/solo/index.ts"),
      "@symplek/core/": resolve(__dirname, "../symplek-core/src/"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
