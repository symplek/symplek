# Invariants

> Owner: operator · Last attested: 2026-09-29 (against weft-workspace @ a9c2894) · UNENFORCED count: 6
> Attest after any change to a guarded symbol or enforcing check. Every symbol and test named here was resolved against the live code on the attest date.
> Status per entry: **ENFORCED** (an automated check fails if it breaks), **ENFORCED + Gap** (core is checked, a residual is not; the residual sits in the debt queue), **UNENFORCED**.

## Architecture boundaries

INV-001 · `packages/weft-core/src` never imports `weft-pro`.
  Why: the open-core split (DEC-003); the free tier must not depend on the commercial one.
  Enforced by: `.github/workflows/ci.yml` (the `tier-boundary` job); no local test holds it.
  Anchors: tier-boundary
  Class: Architecture boundaries
  Status: ENFORCED + Gap
  Gap: the job greps for `from "weft-pro` in `.ts` files only, so `require`, dynamic `import()` and `.tsx` are missed, and it cannot run locally. A vitest that scans the same tree would close it.

INV-002 · The `weft-core` root barrel exports no server-only symbol (`Weft`, `WeftBuilder`, `ProviderRegistry`, `providerRegistry`).
  Why: the root must load in browsers without provider SDKs (DEC-007).
  Enforced by: `packages/weft-core/src/index.ts`, and `packages/weft-core/src/__tests__/boundaryTest.test.ts` fails if one appears.
  Anchors: AgentUnit, createContext
  Class: Architecture boundaries
  Status: ENFORCED

INV-003 · Every free-tier operator (`solo`, `interview`, `conduct`, `dialectic`, `debate`, `coherence`, `converge`, `consensus`, `rehearse`, `replay`) exists on `AgentUnit` from `weft-core` alone.
  Why: developer primitives are free forever (DEC-003).
  Enforced by: `packages/weft-core/src/AgentUnit/operators/index.ts`, and `packages/weft-core/src/__tests__/tierBoundary.test.ts` asserts each prototype method.
  Anchors: AgentUnit
  Class: Architecture boundaries
  Status: ENFORCED

INV-021 · Workspace packages import `weft-core` only through its published entry points, never by relative path into `packages/weft-core`.
  Why: a relative import bundles core source into a second package and splits the module singletons (registry, config, trace store) in two (DEC-002, DEC-007).
  Enforced by: eight of the ten package tsconfigs (`packages/weft-pro/tsconfig.json` among them) set `rootDir` to `./src`, which should reject a source import from outside the package at typecheck; not exercised by any test. `weft-testing` and `weft-devtools` set no `rootDir`, and `packages/weft-testing/tsconfig.json` maps `weft-core/rehearsal` straight onto core source through `paths`. The drift gate also warns on added imports (`boundaries` in `docs/ANCHORS.json`), advisory only.
  Anchors: docs/ANCHORS.json
  Class: Architecture boundaries
  Status: UNENFORCED
  Gap: a CI step that greps every package's `src` for a relative path containing `weft-core`; `weft-testing` and `weft-devtools` have no `rootDir` guard at all, and the `weft-testing` `paths` mapping already reaches into core source.

INV-004 · Only `createTrackedResult` can produce a value that `isTrackedResult` accepts; a forged object with a leaked marker is rejected.
  Why: zero-trust provenance (DEC-006); caches and stores rely on it.
  Enforced by: `packages/weft-core/src/trust.ts::isTrackedResult`, and `packages/weft-core/src/__tests__/trust-hardening.test.ts` ("Marker extraction resistance").
  Anchors: createTrackedResult, isTrackedResult
  Class: Provenance and idempotency
  Status: ENFORCED

INV-005 · A run with an idempotency key executes its computation once per key, and a cached value that is not a genuine `TrackedResult` is rejected.
  Why: side-effecting agent runs must not duplicate; a poisoned store must not inject results (DEC-006, DEC-010).
  Enforced by: `packages/weft-core/src/idempotency.ts::defaultIdempotencyStore`, and `packages/weft-core/src/__tests__/idempotency.test.ts` plus `packages/weft-core/src/__tests__/idempotency-poisoning.test.ts`.
  Anchors: InMemoryIdempotencyStore, IdempotencyError
  Class: Provenance and idempotency
  Status: ENFORCED + Gap
  Gap: if the store write fails after the side effect ran, the key is not persisted and a later call re-executes. The source states this boundary; only idempotent side effects close it.

INV-006 · An `AgentUnit` whose operator augmentation did not load fails `run()` with `SETUP_ERROR` instead of a missing-method crash.
  Why: operators attach by prototype augmentation and an internal-path import silently drops them (DEC-005).
  Enforced by: `packages/weft-core/src/AgentUnit/AgentUnit.ts` (the runtime guard in `run`); nothing tests it. The `SETUP_ERROR` case in `packages/weft-core/src/__tests__/golden-path.test.ts` constructs its own `WeftError` and never triggers the guard.
  Anchors: AgentUnit
  Class: Provenance and idempotency
  Status: UNENFORCED
  Gap: a test that deletes `AgentUnit.prototype.retry`, calls `run`, and expects the `SETUP_ERROR` code.

## Security

INV-007 · Provider errors and unknown-error paths never carry an API key in their message or cause.
  Why: keys must not reach logs or traces.
  Enforced by: `packages/weft-core/src/providers/redact.ts::redactErrorMessage`, and `packages/weft-core/src/providers/__tests__/redact.test.ts` plus `packages/weft-core/src/providers/__tests__/ai-unknown-error-redaction.test.ts`.
  Anchors: redactErrorMessage, redactEnvKeys, safeCause
  Class: Security
  Status: ENFORCED

INV-008 · A golden trace is written with credential-shaped strings redacted by default.
  Why: golden traces are committed to the caller's repository (DEC-009).
  Enforced by: `packages/weft-core/src/rehearsal/golden.ts::toGoldenTrace`, and `packages/weft-core/src/rehearsal/__tests__/golden.test.ts` ("default redaction (safe by omission)").
  Anchors: toGoldenTrace, DEFAULT_SECRET_PATTERNS
  Class: Security
  Status: ENFORCED + Gap
  Gap: the default patterns are a floor for well-known credential shapes; a secret with another shape survives unless the caller supplies `redactPatterns`.

INV-009 · A tool marked `requiresApproval` never executes without passing the approval callback, and its input is parsed by its Zod schema first.
  Why: side effects need a human gate (DEC-012 covers the older, tool-less agent path).
  Enforced by: `packages/weft-core/src/agent/executor.ts::executeLoop`, and `packages/weft-core/src/__tests__/tool-loop.test.ts` ("No side effect executes without passing the approval gate").
  Anchors: executeLoop, tool
  Class: Security
  Status: ENFORCED

INV-010 · `weft-mcp` validates `tools/call` arguments against the tool's `inputSchema` before dispatch.
  Why: MCP clients are untrusted (DEC-016).
  Enforced by: `packages/weft-mcp/src/server/validateInput.ts`, and `packages/weft-mcp/src/server/__tests__/validateInput.adversarial.test.ts`.
  Anchors: WEFT_MCP_TOOLS, startWeftMcpServer
  Class: Security
  Status: ENFORCED

INV-011 · `withAI` refuses activity logging without an `activityContext` and cost tracking without `costContext.userId`.
  Why: without a scope, activity and cost rows would be attributed across users.
  Enforced by: `packages/weft-convex/src/withAI.ts::withAI`, and `packages/weft-convex/src/__tests__/withAI-scoping.test.ts`.
  Anchors: withAI
  Class: Security
  Status: ENFORCED

INV-012 · `weft-pro` features load only with a licence key.
  Why: the commercial tier (DEC-015).
  Enforced by: `packages/weft-pro/src/license-gate.ts` throws at import when no key is set; no test imports the gate. `packages/weft-pro/src/__tests__/license.test.ts` re-tests a regex against strings and cannot fail if the gate is removed.
  Anchors: validateLicense, isProLicensed
  Class: Security
  Status: UNENFORCED
  Gap: a test that imports each pro module in a fresh module registry with the env var unset and expects a throw; the key check itself is format-only, so it is not an access control.

INV-013 · The private canonical source and the `weft-core` mirror keep their recorded relationship on `AgentUnit`, `WeftError`, `WeftBuilder` and `RetryOptions`, including the deliberate differences in DEC-004.
  Why: manual sync must not drift silently (DEC-004).
  Enforced by: `packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts`, which skips every suite here because the canonical directory does not exist in this repo.
  Anchors: canonicalPresent
  Class: Architecture boundaries
  Status: UNENFORCED
  Gap: the check runs only upstream; a mirror-side snapshot of the four shared shapes would fail here when the mirror changes.

INV-018 · The DevTools content script forwards only same-frame messages from allow-listed origins with the exact bridge shape and at most 256 KB.
  Why: a page must not spoof or flood the extension (DEC-018).
  Enforced by: `packages/weft-devtools/src/content/bridge-listener.ts::initBridgeListener`; the only test in the package checks two type shapes.
  Anchors: initBridgeListener
  Class: Security
  Status: UNENFORCED
  Gap: a test that posts spoofed, oversize and wrong-origin messages to `initBridgeListener` under jsdom.

## Data integrity and release

INV-014 · A replayed trace fails loudly on a tampered event or final output.
  Why: replay is used as a test oracle (DEC-009).
  Enforced by: `packages/weft-core/src/rehearsal/replayer.ts::TraceReplayer`, and `packages/weft-core/src/rehearsal/__tests__/integrity-defects.test.ts`.
  Anchors: TraceReplayer, ReplayDivergenceError
  Class: Data integrity and release
  Status: ENFORCED + Gap
  Gap: event hashes are DJB2, a corruption check, so a deliberate forger can recompute them.

INV-015 · The durable file backend never lets two distinct keys share a file, including keys that differ only by case.
  Why: case-insensitive filesystems aliased durable keys (commit a9c2894, DEC-010).
  Enforced by: `packages/weft-core/src/store/file-backend.ts::createFileBackend`, and `packages/weft-core/src/__tests__/store.test.ts` (the injective-encoding and case-aliasing suites).
  Anchors: createFileBackend
  Class: Data integrity and release
  Status: ENFORCED

INV-016 · Every published package builds a `dist` in CI before release.
  Why: an unbuilt package publishes an empty tarball (DEC-002).
  Enforced by: `.github/workflows/ci.yml` (the "Check build artefacts present" step).
  Anchors: build
  Class: Data integrity and release
  Status: ENFORCED

INV-017 · No published package.json still contains a `workspace:` specifier after packing.
  Why: a literal `workspace:*` cannot be installed from npm (DEC-002).
  Enforced by: `.github/workflows/ci.yml` (the "Inspect packed weft-pro" step).
  Anchors: build
  Class: Data integrity and release
  Status: ENFORCED + Gap
  Gap: only `weft-pro` is packed and inspected; `weft-react`, `weft-convex`, `weft-mcp` and `weft-testing` also declare `weft-core` as `workspace:*`.

INV-019 · The `weft-core` root bundle stays within 25 KB and `weft-core/server` within 40 KB.
  Why: the root is meant to be light enough for browsers (DEC-007).
  Enforced by: the `size-limit` block in `packages/weft-core/package.json` and its `test:size` script; CI never runs it.
  Anchors: build
  Class: Data integrity and release
  Status: UNENFORCED
  Gap: add `pnpm --filter weft-core run test:size` to the `build` job.

INV-020 · TypeScript blocks in README files do not call removed weft-core APIs.
  Why: docs drift misled consumers (audit findings B11, N48, N58).
  Enforced by: `packages/weft-core/src/__tests__/docs-drift.test.ts`.
  Anchors: FORBIDDEN
  Class: Data integrity and release
  Status: ENFORCED + Gap
  Gap: the test is a denylist of three patterns and does not check that a documented hook or function exists (`useWeftStream` is named in the README and exists nowhere).

## UNENFORCED list (enforcement debt queue)

- INV-006: a test that removes an operator from the prototype and expects `SETUP_ERROR` from `run`.
- INV-012: a test that imports the pro gate with no key and expects a throw.
- INV-013: a mirror-side snapshot of the four shared shapes that does not skip.
- INV-018: a jsdom test that feeds `initBridgeListener` spoofed, oversize and wrong-origin messages.
- INV-019: run `size-limit` in CI.
- INV-021: a CI grep for relative imports into `packages/weft-core`.
- Gaps on enforced entries: INV-001 (scan all import forms), INV-005 (idempotent side effects), INV-008 (caller patterns), INV-014 (cryptographic hashes), INV-017 (pack every package), INV-020 (check documented symbols exist).
