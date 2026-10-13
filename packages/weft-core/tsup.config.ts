import { defineConfig } from "tsup";

/**
 * tsup build configuration for weft-core.
 *
 * splitting: true — creates shared CJS chunks for code referenced by multiple
 * entry points. Without splitting, every CJS entry bundles its own copy of
 * shared modules (e.g. ProviderRegistry, AgentUnit). The result is that
 * `require("weft-core")` and `require("weft-core/server")` each get their own
 * singleton instances, so registering a provider via the server entry leaves
 * the root entry's registry empty (B6).
 *
 * With splitting enabled tsup emits shared `chunk-*.cjs` files that every CJS
 * entry requires. All entry points then share the same singletons.
 */
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server.ts",
    "src/confidence/index.ts",
    "src/coherence/index.ts",
    "src/interview/index.ts",
    "src/change-kernel/index.ts",
    "src/operators/index.ts",
    "src/rehearsal/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  outDir: "dist",
  splitting: true,
  clean: true,
  // External packages that consumers must supply (peer or optional deps).
  // Listing them here prevents tsup from bundling them into dist/,
  // which would bloat the package and shadow the consumer's installation.
  external: [
    "openai",
    "@anthropic-ai/sdk",
    "@google/generative-ai",
    "@opentelemetry/api",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-trace-node",
    "zod",
  ],
});
