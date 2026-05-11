# Contributing to Weft

Thanks for looking at the code. Before you open a PR, read this — it will save both of us time.

---

## How this repo works

**This repo is a distribution mirror.**

The authoritative Weft source lives in a private monorepo used by our own application. On each release cycle, the portable subset is extracted into the packages here and published to npm. There is no automated sync — see [SYNC.md](SYNC.md) for the flow.

What this means for contributors:

- **You can open PRs here.** We read them, run them in CI, and if they pass review, we backport the change to the canonical source on the next release cycle.
- **We cannot accept PRs that touch internal concerns.** Anything that depends on Convex-specific types (`AgentContext` from Convex, `ctx.scheduler`, etc.) belongs in the upstream app, not here.
- **Turnaround is slower than a single-codebase OSS project.** Changes land in the packages here after they've been validated against the canonical source. We aim for two-week release cycles.

If you want to understand which concepts are shared between the canonical source and this mirror, and where they intentionally diverge, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Filing a bug

Use the [Bug report issue template](.github/ISSUE_TEMPLATE/bug_report.md).

A useful bug report includes:

1. A **minimal reproduction** — the shortest code that triggers the problem. A link to a StackBlitz or a plain Node script is ideal.
2. What you expected to happen.
3. What actually happened, including the full error message and stack trace.
4. Your environment: Node version, package versions (`pnpm list @weft/core`).

We cannot investigate bugs that don't have a reproduction. "It throws sometimes" is not actionable.

---

## Proposing a feature

**Open a Discussion before opening a PR.**

Feature PRs without prior Discussion agreement are closed without review. This is not a gate to slow you down — it's to avoid the situation where you invest time writing code for something we've already decided not to support, or something that belongs in `@weft/pro` rather than `@weft/core`.

The Discussion process is:

1. Open a thread in [Discussions → Ideas](https://github.com/wefthq/weft/discussions/categories/ideas).
2. Describe the problem you're solving, not the solution you've designed.
3. If maintainers agree it fits the scope and tier, we'll say so explicitly in the thread.
4. Then open a PR that references the Discussion.

Features in scope for `@weft/core`: developer-facing primitives that make AgentUnit composition easier or more expressive. Free forever.

Features in scope for `@weft/pro`: organisational coordination, governance, and advanced observability. Commercial licence.

Features out of scope for this repo: anything that requires the upstream application's Convex runtime, scheduler, or database bindings.

---

## Code style

We use [Biome](https://biomejs.dev/) for formatting and linting. No ESLint, no Prettier.

```
pnpm --filter "@weft/*" run lint
pnpm --filter "@weft/*" run typecheck
```

Match the style of the surrounding code. We are not prescriptive about every micro-preference, but the formatter is non-negotiable — CI will fail on format violations.

---

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

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
pnpm --filter "@weft/*" run build
pnpm --filter "@weft/*" test
```

The test suite includes canonical ↔ mirror contract tests that read source files from a relative path (`../../../../convex/lib/agent_framework/`). When running in this mirror repo without the upstream canonical source present, those structural fallback tests will fail. That is expected — they exist to guard against drift in the ProSentinel monorepo context. The runtime behaviour tests (which do not read canonical source files) will pass.

If you are writing a new test, add it to the appropriate package under `src/__tests__/`. Follow the existing pattern: runtime behaviour tests first, structural fallback tests where live import is impossible due to Convex-specific types.

---

## What not to send

- PRs that add dependencies on `convex`, `@convex-dev/*`, or any Convex-specific runtime type. Those belong upstream.
- PRs that modify `@weft/pro` in a way that weakens the tier boundary. The boundary between free and commercial is a deliberate product decision, not an implementation accident.
- PRs against the `dev` branch. Target `main`.
- Large refactors without prior Discussion agreement. Refactors that touch the core algebra are high-risk and require careful review against the canonical source.

---

## Backport note

If you believe your change also benefits the upstream application (not just the mirror packages), add a `Backport candidate:` note in your PR description. We use that signal during the release sync. It does not affect merge criteria — all PRs are evaluated solely on their merit for the published packages.
