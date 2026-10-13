import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Several suites here run the TypeScript compiler or load the whole CLI
    // on first use. Those take longer than vitest's 5 second default on a
    // busy machine or a cold CI runner, which made them fail at random.
    testTimeout: 60_000,
  },
});
