import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve weft-core imports to source so tests run without a build step.
      // The subpath alias must be listed BEFORE the root alias so that
      // "weft-core/rehearsal" is matched first.
      "weft-core/rehearsal": resolve(
        __dirname,
        "../weft-core/src/rehearsal/index.ts",
      ),
      "weft-core": resolve(__dirname, "../weft-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
