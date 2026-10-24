# Contributing to Symplek

Thanks for looking at the code. Before you open a PR, read this — it will save both of us time.

---

## How this repo works

**This repo is a distribution mirror.**

The authoritative Symplek source lives in a private monorepo used by our own application. On each release cycle, the portable subset is extracted into the packages here and published to npm. There is no automated sync — see [SYNC.md](SYNC.md) for the flow.

What this means for contributors:

- **You can open PRs here.** We read them, run them in CI, and if they pass review, we backport the change to the canonical source on the next release cycle.
- **We cannot accept PRs that touch internal concerns.** Anything that depends on Convex-specific types (`AgentContext` from Convex, `ctx.scheduler`, etc.) belongs in the upstream app, not here.
- **Turnaround is slower than a single-codebase OSS project.** Changes land in the packages here after they've been validated against the canonical source. We aim for two-week release cycles.

If you want to understand which concepts are shared between the canonical source and this mirror, and where they intentionally diverge, read [docs/ARCHITECTURE-FULL.md](docs/ARCHITECTURE-FULL.md).

---

## Filing a bug

Use the [Bug report issue template](.github/ISSUE_TEMPLATE/bug_report.md).

A useful bug report includes:

1. A **minimal reproduction** — the shortest code that triggers the problem. A link to a StackBlitz or a plain Node script is ideal.
2. What you expected to happen.
3. What actually happened, including the full error message and stack trace.
4. Your environment: Node version, package versions (`pnpm list @symplek/core`).

We cannot investigate bugs that don't have a reproduction. "It throws sometimes" is not actionable.

---

## Proposing a feature

**Open a Discussion before opening a PR.**

Feature PRs without prior Discussion agreement are closed without review. This is not a gate to slow you down — it's to avoid the situation where you invest time writing code for something we've already decided not to support, or something that belongs in `@symplek/pro` rather than `@symplek/core`.

The Discussion process is:

1. Open a thread in [Discussions → Ideas](https://github.com/symplek/symplek/discussions/categories/ideas).
2. Describe the problem you're solving, not the solution you've designed.
3. If maintainers agree it fits the scope and tier, we'll say so explicitly in the thread.
4. Then open a PR that references the Discussion.

Features in scope for `@symplek/core`: developer-facing primitives that make AgentUnit composition easier or more expressive. Free forever.

Features in scope for `@symplek/pro`: organisational coordination, governance, and advanced observability. Commercial licence.

Features out of scope for this repo: anything that requires the upstream application's Convex runtime, scheduler, or database bindings.

---

## Code style

We use [Biome](https://biomejs.dev/) for linting. No ESLint, no Prettier.

```
pnpm lint
pnpm build
pnpm typecheck
```

Build before you type check: packages resolve each other's types through the built `dist/` output.

Match the style of the surrounding code. Biome's formatter is switched off in `biome.json`, so CI does not check formatting. CI fails on lint errors. A handful of rules are downgraded to warnings in `biome.json`, and warnings do not fail the build.

---

## Commit conventions

We ask for [Conventional Commits](https://www.conventionalcommits.org/) on pull requests:

```
feat(core): add .tap() operator
fix(react): close stream on unmount
docs(contributing): clarify backport timeline
test(core): add retry edge case for zero maxAttempts
```

Breaking changes go in the commit footer:

```
feat(core)!: remove deprecated .withTimeout() in favour of .timeout()

BREAKING CHANGE: .withTimeout(ms) is removed. Use .timeout(ms) instead.
```

Every merged commit that affects a published package needs a changeset. See [.changeset/README.md](.changeset/README.md).

---

## Running tests

```
pnpm install --frozen-lockfile
pnpm --filter "@symplek/*" run build
pnpm --filter "@symplek/*" test
```

The test suite includes canonical ↔ mirror contract tests (`packages/symplek-core/src/__tests__/canonicalMirrorContract.test.ts`) that read source files from a relative path (`../../../../convex/lib/agent_framework/`). That source is not in this repo, so the whole file skips itself here: `@symplek/core` reports one skipped test file. Nothing fails. It also means nothing in this repo checks for drift against the upstream source. Every other test should pass.

If you are writing a new test, add it to the appropriate package under `src/__tests__/`. Follow the existing pattern: runtime behaviour tests first, structural fallback tests where live import is impossible due to Convex-specific types.

---

## What not to send

- PRs that add dependencies on `convex`, `@convex-dev/*`, or any Convex-specific runtime type. Those belong upstream.
- PRs that modify `@symplek/pro` in a way that weakens the tier boundary. The boundary between free and commercial is a deliberate product decision, not an implementation accident.
- PRs against any branch other than `main`.
- Large refactors without prior Discussion agreement. Refactors that touch the core algebra are high-risk and require careful review against the canonical source.

---

## Backport note

If you believe your change also benefits the upstream application (not just the mirror packages), add a `Backport candidate:` note in your PR description. We use that signal during the release sync. It does not affect merge criteria — all PRs are evaluated solely on their merit for the published packages.
