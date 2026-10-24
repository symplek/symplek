import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The smoke test only imports type-only constructs from persistence.ts;
    // jsdom is available as a devDep but the smoke test does not exercise
    // the actual IDB calls, so node environment is sufficient here.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
