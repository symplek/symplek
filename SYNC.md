# Sync model

This repo is the **public distribution mirror** for Weft. It is not where Weft is developed day-to-day.

## Why two repos

Weft's maintainers develop Weft inside a private monorepo alongside the application that originally consumed it. That application is not open-sourced and won't be. Keeping Weft's source in that monorepo lets the maintainers move fast on internal-facing changes without leaking application code into the public history.

This mirror exists so that:

1. The `weft-*` npm packages have a public source-of-truth that users, security researchers, and external contributors can read.
2. External contributions have somewhere to land.
3. Issues, discussions, and releases live in one public place.

## How sync works

There is **no automation for the sync itself**. Copying code between the two repos is a manual act, performed by a maintainer, at release time. Publishing is automated by CI once changes land on `main` here.

### Upstream → mirror (the common direction)

1. A maintainer cuts a release tag in the upstream private monorepo.
2. The relevant `packages/weft-*` subtrees are copied into this repo.
3. The maintainer adds changesets for the change and pushes to `main` here.
4. The `release` job in `.github/workflows/ci.yml` opens or updates a "Version Packages" pull request. That pull request runs `changeset version`: the version bumps and CHANGELOG entries.
5. Merging that pull request makes the same job run `pnpm release`, which builds the packages and runs `changeset publish`. That pushes to npm and creates the git tags.

### Mirror → upstream (external contributions)

1. An external contributor opens a PR against `main` here.
2. A maintainer reviews and merges here.
3. Within the next release cycle, the maintainer backports the merged change into the upstream private monorepo.
4. The change is included in the next release tag, which sync re-applies here.

This means a merged PR may appear here under one commit hash and ship to npm under a different one. That is intentional, not a mistake.

## Drift detection

`packages/weft-core/src/__tests__/canonicalMirrorContract.test.ts` (in this repo and upstream) asserts behavioural and structural equivalence on four shared concepts: `AgentUnit`, `WeftError`, `WeftBuilder`, `RetryOptions`. It reads the upstream source from a path that only exists in the upstream monorepo. In this repo every suite in the file skips itself, so CI here cannot detect drift. Drift is only caught when the test runs upstream, and a maintainer must reconcile it before the next release.

Some asymmetries are **deliberate** and documented in [`docs/ARCHITECTURE-FULL.md`](docs/ARCHITECTURE-FULL.md). Do not "fix" them.

## Release cadence

Nothing has been released yet, so this is the intended cadence, not a track record.

- Patch releases: as needed, aiming for within 14 days of a confirmed bug.
- Beta releases: every 2–4 weeks while in beta.
- Stable 1.0: held until the operator API has accumulated 3–6 months of real external usage without breaking-change pressure.

## Questions

If you're trying to figure out whether to file an issue here or wait for sync, file it here. The maintainer will route.
