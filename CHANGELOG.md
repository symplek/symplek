# Changelog

All notable changes to the Symplek monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-package changelogs live in each package directory (`packages/*/CHANGELOG.md`). Today
`@symplek/core`, `@symplek/pro` and `@symplek/cli` have one; Changesets creates the others the first time
their package is versioned. This file covers the monorepo as a whole: cross-cutting changes,
new packages, breaking renames, and release-coordination notes.

## [Unreleased]

Nothing has been published to npm yet. `1.0.0-beta.1` (2026-04-13) was an internal milestone
for `@symplek/core` and `@symplek/pro` and was never published or tagged. The notes for the first
public beta are the changeset files in `.changeset/`; they become the per-package changelog
entries when that release is versioned.

### What is Symplek?

Symplek is a set of composable agent primitives for TypeScript. It replaces
hand-rolled coordination scaffolding (promise chains, retry loops, consensus
aggregation, result tracking) with a small algebra centred on `AgentUnit<T>`.
The same coordination patterns (retry, timeout, fallback, parallel consensus,
iterative refinement) compose as method chains on a single type.

Symplek was extracted from a real product. The API was shaped by actual usage, not
by imagining what developers might want. The core is MIT-licensed. Its one
required peer dependency is `zod`; the provider SDKs are optional peers, loaded
on first use.

### What's included

- **`@symplek/core`** (MIT): The `AgentUnit` algebra: composition, resilience,
  coordination, record and replay, and observability operators. Provider
  adapters for OpenAI, Anthropic, and Google. The `Symplek` namespace facade for
  single-prompt work and streaming. Golden-path test suite
  (`pnpm --filter @symplek/core run test:golden`).

- **`@symplek/pro`** (BSL 1.1): TaCo consensus (multi-round iterative voting),
  stigmergy-based collaboration, an antibody registry for output quality and a
  trust registry for scan-depth control. It also re-exports `@symplek/core`'s
  teams, confidence, coherence, interview and change-kernel modules behind its
  licence gate. Importing it requires a licence key. Contract test suite.

- **`@symplek/react`** (MIT): React bindings: the `useAgent`, `useConsensus` and
  `useSwarm` hooks, `AIProvider` with `useAIConfig`, and `AIErrorBoundary`.

- **`@symplek/convex`** (MIT): Convex action helpers (`withAI`,
  `streamToMutation`, activity and cost middleware) built on
  `@symplek/core/server`.

- **`@symplek/cli`** (MIT): Project scaffolding (`symplek init`) with minimal,
  standard, and full templates, plus `add`, `validate`, `generate` and
  `migrate`.

- **`create-symplek`** (MIT): Wrapper that runs `symplek init`.

- **`@symplek/mcp`** (MIT): MCP client with trust policies, plus a stdio demo
  server.

- **`@symplek/harness`** (MIT): Adapter that wraps Claude Agent SDK and OpenAI
  agent sessions as `AgentUnit`s, with a replay adapter for recorded tool-use
  traces and a determinism assertion. Alpha.

- **`@symplek/testing`** (MIT): Re-exports the record and replay engine from
  `@symplek/core/rehearsal`.

- **`@symplek/devtools`** (MIT): Chrome DevTools bridge for agent trace and span
  inspection. Private package, not published.

### Breaking rename: `@symplek/*` → `@symplek/*`

Packages moved from the `@symplek/*` npm scope to unscoped `@symplek/*` names. All
imports, install commands, and documentation now use `@symplek/core`, `@symplek/pro`,
etc. The old `@symplek/*` packages do not exist on npm.

### Architecture

Symplek has a canonical source (private upstream monorepo) and this distribution
mirror (`symplek/symplek`). Sync is manual, per-release. The mirror strips
runtime-specific bindings so any consumer can `pnpm add @symplek/core` without
bringing in internal dependencies. A contract test for the shared concepts
lives at `packages/symplek-core/src/__tests__/canonicalMirrorContract.test.ts`.
It needs the upstream source checked out next to it and skips itself in this
repository, so nothing here checks the two for equivalence.

### Release schedule

Symplek is in beta. APIs may change between beta releases. Every breaking change
gets a changelog entry. Packages version independently via Changesets, with two
linked pairs in `.changeset/config.json`: `@symplek/core` with `@symplek/pro`, and
`create-symplek` with `@symplek/cli`. Prerelease mode is on (`.changeset/pre.json`),
so versions carry a `-beta.N` suffix.
