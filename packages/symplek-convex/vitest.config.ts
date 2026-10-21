import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@symplek/core/server",
        replacement: resolve(__dirname, "../symplek-core/src/server.ts"),
      },
      {
        find: "@symplek/core",
        replacement: resolve(__dirname, "../symplek-core/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
