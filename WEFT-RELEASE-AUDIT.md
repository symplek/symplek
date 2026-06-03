# Weft Release-Readiness Audit

> Audit date: **2026-06-02** · Scope: **weft-core, weft-pro, weft-cli** (the published release line)
> Mode: **audit only — no code changed**. This document is the deliverable: findings, prioritized
> remediation, and a proposed changelog. Apply the fixes in a follow-up patch branch.

## Verdict

| Package | Version | Verdict | Blocking items |
|---|---|---|---|
| weft-core | 1.0.0-beta.1 | **NOT READY** | 1 blocker, 1 high secret-leak |
| weft-pro | 1.0.0-beta.1 | **NOT READY** | 1 blocker (CI blind), 1 correctness high |
| weft-cli | 0.1.0 | **NOT READY** | 1 blocker (binary dead on Linux) |
| Release plumbing & docs | — | **NOT READY** | 4 doc/scope blockers |

**Overall: do not publish.** 6 confirmed blockers, all small and mechanical except two correctness
fixes (weft-core `configure()`, weft-pro TaCo veto). A focused 1–2 day patch branch clears the line.

Severity legend: **BLOCKER** = breaks install/use or ships a lie · **HIGH** = real defect, fix before 1.0 ·
**MEDIUM** = fix soon · **LOW** = cleanup. Confidence: **confirmed** = I verified it directly ·
**high** = two agreeing reviewers · **needs-checking** = single reviewer, plausible, unverified.

---

## Blockers (must fix before any publish)

### B1 · weft-cli binary is dead on Linux/CI — `confirmed`
`packages/weft-cli/package.json:7` declares `"bin": { "Weft": "./bin/Weft.js" }` but the shipped file
is `packages/weft-cli/bin/weft.js` (lowercase). On any case-sensitive filesystem (Linux, most CI, npm
consumers) the installed binary symlink does not resolve — `weft` is a dead command after `npm i -g`.
The bin *name* `Weft` is also non-idiomatic.
**Fix:** `"bin": { "weft": "./bin/weft.js" }` (both lowercase).

### B2 · `weft --version` prints `2.0.0`, package is `0.1.0` — `confirmed`
`packages/weft-cli/src/index.ts:65` hardcodes `.version("2.0.0")`. Users and tooling that parse
`weft --version` get a wrong, fictional version.
**Fix:** read `version` from the package's own `package.json` at runtime; never hardcode.

### B3 · weft-pro has no `test` script — CI runs zero tests and reports green — `confirmed`
`packages/weft-pro/package.json` defines `test:contract` but no `test`. The root `pnpm test`
(`pnpm --filter "weft-*" test`) silently skips weft-pro entirely, so CI is a false-green gate before
release.
**Fix:** add `"test": "vitest run"` (or alias to `test:contract` until the suite is broader).

### B4 · `Weft.configure()` is a documented no-op — `confirmed`
`packages/weft-core/src/facade.ts` writes `_globalConfig` at line 133 but **nothing reads it** — not
`ai()`, not `detectProvider()`, not the builders. The documented "one-time global configuration"
(`provider`/`model`/`apiKey`/`debug`) silently does nothing. Shipping this in 1.0 breaks trust on the
first call a user makes.
**Fix:** either wire `_globalConfig` into `ai()`/`detectProvider()`, or remove the method and its type
from the public surface before 1.0.

### B5 · weft-cli ships with no CHANGELOG — `confirmed`
`packages/weft-cli/` has no `CHANGELOG.md` (weft-core and weft-pro both do), and its `package.json`
`files` array (`["bin","dist"]`) wouldn't ship one anyway. No release history, no audit trail.
**Fix:** create `packages/weft-cli/CHANGELOG.md` in the repo's Keep-a-Changelog format (template
below) and add `"CHANGELOG.md"` to `files`.

### B6 · Public docs still use the dead `@weft/*` npm scope — `confirmed`
Packages were renamed `@weft/*` → unscoped `weft-*` (commit 20f4f8f), but the install/import snippets
across the docs still say `@weft/core` etc. A new user runs `pnpm add @weft/core` (does not exist on
npm). Confirmed in `README.md:18,44,96`; reviewers also found it in `CONTRIBUTING.md`, `SECURITY.md`,
`docs/ARCHITECTURE.md`, `docs/ARCHITECTURE-FULL.md`, `docs/tier-boundary.md`.
**Fix:** replace every `@weft/<name>` with `weft-<name>` across docs; server entry is `weft-core/server`.

---

## High-severity findings

### weft-core
- **H1 · `weft-core/server` hard-imports all three optional provider SDKs — `confirmed`.**
  `dist/server.js:17,20,…` top-level `import` of `@anthropic-ai/sdk`, `@google/generative-ai`,
  `openai`. All three are declared **optional** peer deps. A user who installs only one provider and
  imports `weft-core/server` gets `MODULE_NOT_FOUND` at load. *(Correction to initial review: this
  affects the `server` entry only — the browser-safe `.`/`index.js` entry and the shared chunk are
  clean. It is not an every-install crash.)*
  **Fix:** dynamically import the selected provider SDK inside its adapter, so only the provider in use
  must be installed.
- **H2 · API key can leak through retained `error.cause` — `high`.**
  Provider adapters (`providers/{anthropic,openai,google}.ts`) redact the key from `error.message` but
  attach the raw SDK error as `cause`, which commonly carries the key in `Authorization` headers.
  `console.error`, `util.inspect`, and Sentry-style `.cause` walkers surface it. The changelog's "keys
  surface only as WeftError" claim is only half true.
  **Fix:** deep-sanitize or drop `cause` before attaching.
- **H3 · Schema generic lost at builder boundary — `high`.** `builder.ts` calls `ai(task, { … } as any)`,
  collapsing `TrackedResult<T>` to `TrackedResult<any>` for schema-validated calls.
- **H4 · `selectModelForTask()` hardcodes OpenAI models for every provider — `high`.**
  `providers/auto.ts` returns `gpt-4o`/`gpt-4o-mini` regardless of active provider; Anthropic/Google-only
  users with no explicit `model` get a model string their provider rejects.
- **H5 · Anthropic usage chunks swallowed → token counts undercounted — `high`.** Usage metadata is
  piggybacked on `textDelta: ''`, which the streaming layer treats as falsy and drops.

### weft-pro
- **H6 · TaCo veto can be silently lost — `needs-checking`.** If a veto fires in an early round but
  convergence occurs in a later veto-free round, the early-exit path returns without `vetoedBy` — the
  veto is ignored. A correctness/safety issue for veto-dependent callers. **Fix:** break the loop
  immediately on veto.
- **H7 · `converge` parallel mode is non-deterministic — `high`.** Default `parallel=true` makes state
  "last result by array index wins"; intermediate contributions are discarded with no warning.
- **H8 · In-memory lock state is a process-global singleton — `high`.** `solo/lock.ts` keeps
  `activeLocks` at module level; lock state leaks across unrelated operations and tests.
- **H9 · `workspace:*` peer dep — `confirmed` (mitigated).** `peerDependencies.weft-core` is
  `workspace:*`. `changeset publish` on pnpm rewrites this, so it's safe **only** via that path; a raw
  `npm publish` would ship an unresolvable range. **Fix:** add a CI pack-and-inspect step asserting the
  packed tarball has a semver range, not `workspace:*`.

### weft-cli
- **H10 · `__dirname` in template resolution — `high`.** `src/utils/templates.ts` uses `__dirname`;
  safe under the CLI's CJS build today, but a latent ESM footgun. Prefer `fileURLToPath(import.meta.url)`.
- **H11 · Default name `my-Weft-project` fails the CLI's own validator — `confirmed`.** In `--yes` mode
  the default skips validation then trips the kebab-case check downstream.
- **H12 · Unnormalized project name in `existsSync` check — `high`.** Names with path separators are
  checked relative to cwd; normalize to a basename and reject separators.

### Release engineering / CI
- **H13 · CI build-artefact check skips weft-pro and weft-cli — `high`.** `.github/workflows/ci.yml`
  only verifies `dist/` for core/convex/react; a silent build break in pro or cli is missed.
- **H14 · No CI release job — `high`.** Publish is fully manual (`pnpm build && changeset publish`);
  human-error risk (publish from dirty tree, skip build/tests). Add a gated publish step or the
  `changesets/action` flow.
- **H15 · Observability tier docs contradict each other — `high`.** `weft-pro/README.md` marks
  Observability pro-only, while `docs/tier-boundary.md` says it moved to core and `weft-core/README.md`
  still lists it as a pro upsell. Pick one truth and align all three.

---

## Medium / Low (fix soon / cleanup)

| ID | Pkg | Sev | Finding | File |
|---|---|---|---|---|
| M1 | core | MED | Key redaction replaces only the first occurrence (string `replace`) | providers/*.ts |
| M2 | core | MED | `ai()` UNKNOWN_ERROR fallback copies `error.message`/`cause` without redaction | ai.ts |
| M3 | core | MED | `operators.ts` is 1345 LOC — over the 1000-LOC ceiling (rule 039) | operators.ts |
| M4 | core | MED | Tool serialization reads Zod internal `_def` — breaks on Zod v4 | agent/executor.ts |
| M5 | core | LOW | `sanitizeContext` has no cycle/array guard (stack overflow + missed redaction) | errors.ts |
| M6 | pro | MED | Antibody confidence weighting lets 2 minor matches outrank 1 critical | antibodies.ts |
| M7 | pro | MED | `extendLock` mutates the lock entry in place | solo/lock.ts |
| M8 | pro | LOW | `@module` annotation says `weft-core/solo/lock` (wrong package) | solo/lock.ts |
| M9 | cli | MED | `getProjectTierFiles()` lists `Weft.config.ts.template` (PascalCase) vs lowercase file | utils/templates.ts |
| M10 | cli | MED | Full-template Dockerfile runs `pnpm install` without `--frozen-lockfile` | templates/.../Dockerfile.template |
| M11 | cli | MED | ReDoS risk in `migrate` regex on arbitrary user files (nested lazy quantifiers, no size cap) | commands/migrate.ts |
| L1 | cli | LOW | `--model` not validated against allow-list → YAML structure injection into user's own file | commands/add.ts |
| L2 | cli | LOW | `printSuccess()` prints `Weft …` examples (break after bin rename) | commands/init.ts |
| R1 | repo | MED | CHANGELOG footer links use dead `aWeft13/Weft` repo, not `wefthq/weft` | core/pro CHANGELOG.md |
| R2 | repo | MED | `WEFT-RELEASE-PLAN.md` dates 5+ weeks stale; references upstream-only paths | WEFT-RELEASE-PLAN.md |
| R3 | repo | MED | Consider `"linked": [["weft-core","weft-pro"]]` so betas version together | .changeset/config.json |
| R4 | repo | LOW | weft-core README links 3 docs that don't exist (quickstart/cookbook/exports) | weft-core/README.md |
| R5 | core | MED | `_`-prefixed `static` members are public/undocumented — use `#private` or `@internal` | AgentUnit.ts |

Dependency scan (`pnpm audit --prod`): 0 critical/high, 3 moderate — all transitive (`ws`, `qs`) and
not in any published tarball's runtime path. Tarballs pack clean (no `src/`, `.env`, secrets, or
fixtures). CLI fetches nothing remote. No action required.

---

## Remediation order

1. **Blockers (B1–B6)** — mechanical except B4. ~half a day.
2. **Secret-leak H2 + redaction M1/M2** — one PR; gates publish.
3. **Correctness H4, H5, H6, H7, H8** — provider defaults, streaming, veto, converge, locks.
4. **Packaging H1, H9, H13, H14** — provider dynamic import + CI hardening.
5. **Docs alignment H15, R1–R4** — scope rename, tier truth, dead links.
6. **Cleanup (M/L)** — structural split of `operators.ts`, Zod `_def`, validations.

Re-run this audit + the Codex pass after step 4 before tagging.

---

## Proposed changelog (apply when fixes land)

Match the repo's existing Keep-a-Changelog format exactly. These are the `[Unreleased]` entries each
package should carry once the above fixes are applied.

### packages/weft-cli/CHANGELOG.md — **create new**
```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Binary now resolves on case-sensitive filesystems: `bin` is `weft` → `./bin/weft.js` (was `Weft`).
- `weft --version` reads the real package version (was hardcoded `2.0.0`).
- Default project name is `my-weft-project`, valid under the kebab-case check in `--yes` mode.
- Project name is normalized to a basename and rejected if it contains path separators.

### Changed

- Template resolution uses `import.meta.url` instead of `__dirname`.
- `migrate` file scan is size-capped and the regex de-nested to avoid pathological backtracking.

## [0.1.0] - 2026-XX-XX

### Added

- Initial release. `weft init` scaffolds minimal, standard, and full project templates.

[Unreleased]: https://github.com/wefthq/weft/compare/weft-cli@0.1.0...HEAD
[0.1.0]: https://github.com/wefthq/weft/releases/tag/weft-cli@0.1.0
```

### packages/weft-core/CHANGELOG.md — add under `[Unreleased]`
```markdown
### Fixed

- `Weft.configure()` global config is now consumed by `ai()` and provider detection (was a no-op).
- Provider error redaction no longer leaks API keys via the retained raw `error.cause`.
- API-key redaction replaces all occurrences, not just the first.
- Anthropic streaming usage metadata is no longer dropped; token totals are accurate.
- `selectModelForTask()` returns provider-appropriate default models instead of hardcoded OpenAI ones.

### Changed

- `weft-core/server` imports provider SDKs dynamically; only the provider in use need be installed.
- Schema generic is threaded through the builder so `TrackedResult<T>` keeps its inferred type.

### Fixed (footer)

- CHANGELOG comparison links point to `wefthq/weft` (was `aWeft13/Weft`).
```

### packages/weft-pro/CHANGELOG.md — add under `[Unreleased]`
```markdown
### Added

- `test` script so standard CI (`pnpm test`) runs the contract suite.

### Fixed

- TaCo veto is honored even when convergence occurs in a later round.
- `converge` documents/guards its parallel last-writer-wins semantics.
- In-memory lock state is per-instance, not a process-global singleton.

### Fixed (footer)

- CHANGELOG comparison links point to `wefthq/weft` (was `aWeft13/Weft`).
```

---

## Codex verification (independent cross-provider pass)

Codex (GPT-5.5, read-only) reviewed the three packages independently. **Verdict: `FAIL` — not ready
to publish.** It confirmed all 6 blockers and the major highs, added one new finding, and overturned
one of ours. Combined verdict: **NOT READY** (both reviewers agree).

| Audit finding | Codex |
|---|---|
| B1 cli bin case, B2 version 2.0.0, B3 pro no `test`, B4 configure() no-op | **CONFIRMS** all four blockers |
| H1 server.js static provider imports | **CONFIRMS** ("missing optional peers can crash import") |
| H2 key leak via `cause`, H4 OpenAI model defaults, H5 Anthropic usage chunks dropped, H9 `workspace:*`, H15 observability docs, M9 template casing | **CONFIRMS** |
| **NEW** | CLI project templates scaffold `Weft.configure(...)` — propagates the B4 no-op into every generated project. Reinforces the "wire it in" decision. Added as **M-NEW**. |
| H6 TaCo veto lost | **DISAGREES** — Codex traced the code and found the veto *is* retained; the convergence early-return is suppressed once `vetoedBy` is set. **H6 is downgraded to a false-positive; verify during build, do not treat as a fix target.** |
| B6/REL doc `@weft/*` scope | **Partial DISAGREE** — Codex only reviewed *package-level* docs and found unscoped names there (except a LICENSE line). The audit's scope findings are about **root** `README.md`/`CONTRIBUTING.md`/`SECURITY.md`/`docs/`, which I verified directly (`README.md:18,44,96` use `@weft/core`). Root-doc finding **stands**; Codex simply wasn't scoped to root. |

**Net effect on the fix list:** add **M-NEW** (template `configure()` propagation); drop **H6**
(false positive). Everything else unchanged. The cross-check did its job — one bug removed from the
backlog, one added.
