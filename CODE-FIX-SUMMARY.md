# CODE FIX SUMMARY

## Blockers

- B1: Verified `packages/weft-cli/package.json` exposes the lowercase `weft` binary mapped to `./bin/weft.js`.
- B2: Verified `packages/weft-cli/src/index.ts` reads the CLI version from `../package.json` instead of hardcoding `2.0.0`.
- B3: Verified `packages/weft-pro/package.json` has `"test": "vitest run"` plus `test:contract`.
- B4: Verified `Weft.configure()` is wired through `globalConfig.ts`, provider bootstrap is awaited by `ai()` and `stream()`, and configured models feed model selection.
- B5: Verified `packages/weft-cli/CHANGELOG.md` exists in Keep-a-Changelog format and is included in the package `files` list.
- B6: Removed the remaining stale `@weft/pro` doc reference from `docs/tier-boundary.md`; the referenced docs now use unscoped `weft-*` package names.

## High Severity

- H1: Verified provider adapters use top-level type-only imports and lazy dynamic SDK imports, avoiding runtime hard imports for optional peer dependencies.
- H2: Verified provider adapter errors use `redactErrorMessage()` and `safeCause()` so raw SDK errors with authorization headers are not retained as `cause`.
- H4: Verified `selectModelForTask()` uses provider-specific model defaults and respects explicit/global model overrides.
- H5: Verified Anthropic streaming emits usage-only chunks and `streaming.ts` accumulates usage independently of truthy `textDelta`.
- H7: Updated parallel converge behavior to fold contributions deterministically in agent order and shallow-merge plain object results, retaining independent fields from multiple agents.
- H8: Moved in-memory lock state from module-level storage to a private `InMemoryLockManager` instance map; legacy module helper functions now delegate to the default manager instance.

## Medium

- M3: Verified `packages/weft-core/src/operators.ts` is now a small barrel file with operator implementations split under `src/operators/`.
- M4: Verified source tool serialization uses public Zod APIs and has no executable `._def` access.

## Tests And Checks

- Passed: `packages/weft-core ./node_modules/.bin/tsc --noEmit`
- Passed: `packages/weft-cli ./node_modules/.bin/tsc --noEmit`
- Passed: `packages/weft-pro ./node_modules/.bin/tsc --noEmit`
- Blocked: focused Vitest run could not start because the installed dependency tree is missing Rollup's Linux native optional package `@rollup/rollup-linux-x64-gnu`.
- Blocked: `weft-core` tsup build could not start for the same missing Rollup native optional package.
