# Sync model

This repo is the **public distribution mirror** for Weft. It is not where Weft is developed day-to-day.

## Why two repos

Weft's maintainers develop Weft inside a private monorepo alongside the application that originally consumed it. That application is not open-sourced and won't be. Keeping Weft's source in that monorepo lets the maintainers move fast on internal-facing changes without leaking application code into the public history.

This mirror exists so that:

1. The npm-published `@weft/*` packages have a public source-of-truth that users, security researchers, and external contributors can read.
2. External contributions have somewhere to land.
3. Issues, discussions, and releases live in one public place.

## How sync works

There is **no automation**. Sync is a manual act, performed by a maintainer, at release time.

### Upstream → mirror (the common direction)

1. A maintainer cuts a release tag in the upstream private monorepo.
2. The relevant `packages/weft-*` subtrees are copied into this repo.
3. The maintainer runs `pnpm changeset version` here to generate the version bump and CHANGELOG entries.
4. The maintainer pushes the release commit to `main` here.
5. The maintainer tags the release and `pnpm changeset publish` pushes to npm.

### Mirror → upstream (external contributions)

1. An external contributor opens a PR against `main` here.
2. A maintainer reviews and merges here.
3. Within the next release cycle, the maintainer backports the merged change into the upstream private monorepo.
4. The change is included in the next release tag, which sync re-applies here.

This means a merged PR may appear here under one commit hash and ship to npm under a different one. That is intentional, not a mistake.

## Drift detection

`packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts` (in this repo and upstream) asserts behavioural and structural equivalence on four shared concepts: `AgentUnit`, `WeftError`, `WeftBuilder`, `RetryOptions`. If these tests fail in CI, sync has drifted and a maintainer must reconcile before the next release.

Some asymmetries are **deliberate** and documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Do not "fix" them.

## Release cadence

- Patch releases: as needed, typically within 14 days of a confirmed bug.
- Minor releases: every 2–4 weeks while in 0.x.
- Major release (1.0): held until the operator API has accumulated 3–6 months of real external usage without breaking-change pressure.

## Questions

If you're trying to figure out whether to file an issue here or wait for sync, file it here. The maintainer will route.
