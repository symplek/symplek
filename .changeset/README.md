# Changesets

Symplek uses [Changesets](https://github.com/changesets/changesets) to manage versioning and CHANGELOG generation.

## When to add a changeset

Any PR that changes a published `@symplek/*` package needs a changeset. PRs that touch only docs, tests, CI, or other non-published files do not.

## How to add one

From the repo root:

```bash
pnpm changeset add
```

You'll be asked:

1. **Which packages changed?** Use space to select, enter to confirm.
2. **What's the bump level?**
   - `patch` — bug fix, internal refactor, no API change.
   - `minor` — new feature, new exports, additive only.
   - `major` — breaking change. While we're 0.x, breaking changes are minor bumps; major is reserved for 1.0+.
   - **Beta note**: `@symplek/core` and `@symplek/pro` are linked — a changeset touching either will bump both to the same version. During the prerelease cycle (`0.x.y-beta.N`) Changesets will append a beta suffix automatically when you are on a prerelease branch.
3. **Summary.** One line. This is what appears in the CHANGELOG.

A new file appears in `.changeset/`. Commit it with your PR.

## What happens at release

A maintainer runs `pnpm changeset version` which:

- Consumes all the changeset files in this directory.
- Bumps `package.json` versions accordingly.
- Updates each affected package's `CHANGELOG.md`.
- Deletes the consumed changeset files.

Then `pnpm changeset publish` pushes the new versions to npm.
