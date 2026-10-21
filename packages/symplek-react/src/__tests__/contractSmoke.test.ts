/**
 * Package Contract Smoke Test — @symplek/react
 *
 * Proves that the package entrypoint (src/index.ts) exports what the
 * package.json contract claims. Imports ONLY from "../index" (the
 * package entrypoint), never from internal modules.
 *
 * @symplek/react depends on @symplek/core and react as peer dependencies.
 * Packed-install verification lives in the root packed-proof harness.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as symplekReact from "../index";

const currentFilePath =
  typeof import.meta.url === "string" && import.meta.url.startsWith("file:")
    ? fileURLToPath(import.meta.url)
    : import.meta.url;
const packageRoot = resolve(dirname(currentFilePath), "../..");
const packageJson = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const boundaryTsconfig = JSON.parse(
  readFileSync(resolve(packageRoot, "tsconfig.boundary.json"), "utf8"),
);

describe("@symplek/react — Package Contract Smoke", () => {
  it("exports the supported root surface and nothing else", () => {
    expect(Object.keys(symplekReact).sort()).toEqual(
      [
        "AIErrorBoundary",
        "AIProvider",
        "useAIConfig",
        "useAgent",
        "useConsensus",
        "useSwarm",
      ].sort(),
    );

    expect("useAI" in symplekReact).toBe(false);
    expect("useAIQuery" in symplekReact).toBe(false);
    expect("useAIStream" in symplekReact).toBe(false);
  });

  it("publishes a single root entrypoint in package.json", () => {
    expect(packageJson.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        require: "./dist/index.cjs",
      },
    });

    expect(packageJson.types).toBe("./dist/index.d.ts");
    expect(packageJson.main).toBe("./dist/index.cjs");
    expect(packageJson.module).toBe("./dist/index.js");
  });

  it("targets only src/index.ts in the boundary typecheck", () => {
    expect(boundaryTsconfig.include).toEqual(["src/index.ts"]);
    expect(boundaryTsconfig.exclude).toContain("src/__tests__/**/*");
    expect(boundaryTsconfig.compilerOptions.rootDir).toBe("./src");
    expect(boundaryTsconfig.compilerOptions.outDir).toBe("./dist");
  });

  it("keeps the package marked experimental while the surface is still small", () => {
    expect(packageJson.version).toBe("0.1.0");
    expect(packageJson.peerDependencies).toMatchObject({
      "@symplek/core": expect.any(String),
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
  });
});
