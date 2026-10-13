import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @symplek/core imports to source so tests run without a build step.
      // The subpath alias must be listed BEFORE the root alias so that
      // "@symplek/core/rehearsal" is matched first.
      "@symplek/core/rehearsal": resolve(
        __dirname,
        "../symplek-core/src/rehearsal/index.ts",
      ),
      "@symplek/core": resolve(__dirname, "../symplek-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
