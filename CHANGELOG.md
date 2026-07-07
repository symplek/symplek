# Changelog

All notable changes to the Weft monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-package changelogs live in each package directory (`packages/*/CHANGELOG.md`). This file
covers the monorepo as a whole: cross-cutting changes, new packages, breaking renames, and
release-coordination notes.

## [1.0.0-beta.1] - 2026-04-13

### What is Weft?

Weft is a set of composable agent primitives for TypeScript. It replaces
hand-rolled coordination scaffolding — promise chains, retry loops, consensus
aggregation, result tracking — with a small algebra centred on `AgentUnit<T>`.
The same coordination patterns (retry, timeout, fallback, parallel consensus,
iterative refinement) compose as method chains on a single type.

Weft was extracted from a real product. The API was shaped by actual usage, not
by imagining what developers might want. The core is 25 KB, MIT-licensed, with
zero required peer dependencies beyond the AI provider SDK you already use.

### What's included

- **`weft-core`** (MIT) — The `AgentUnit` algebra: composition, resilience,
  coordination, reliability, and observability operators. Provider adapters for
  OpenAI, Anthropic, and Google. The `Weft` namespace facade for single-prompt
  work and streaming. Golden-path test suite with 25 passing tests.

- **`weft-pro`** (BSL 1.1) — Advanced multi-agent coordination: TaCo consensus
  (multi-round iterative voting), team coordination via `TeamRegistry`,
  stigmergy-based collaboration, antibody registry for output quality, trust
  registry for scan-depth control, and standalone confidence/coherence scoring
  libraries. Contract test suite.

- **`weft-react`** (MIT) — React hooks for streaming (`useWeftStream`) and error
  boundaries (`AIErrorBoundary`).

- **`weft-convex`** (MIT) — First-class Convex action bindings wrapping
  `weft-core/server`.

- **`weft-cli`** (MIT) — Project scaffolding (`weft init`) with minimal,
  standard, and full templates.

- **`weft-mcp`** (MIT) — MCP server exposing Weft operations as tool calls.

- **`weft-harness`** (MIT) — Replay, rehearse, fault injection, and
  determinism-assertion utilities for testing agent compositions.

- **`weft-testing`** (MIT) — Vitest utilities, mock factories, and deterministic
  provider stubs.

- **`weft-devtools`** (MIT) — Chrome DevTools bridge for agent trace and span
  inspection.

### Breaking rename: `@weft/*` → `weft-*`

Packages moved from the `@weft/*` npm scope to unscoped `weft-*` names. All
imports, install commands, and documentation now use `weft-core`, `weft-pro`,
etc. The old `@weft/*` packages do not exist on npm.

### Architecture

Weft has a canonical source (private upstream monorepo) and this distribution
mirror (`wefthq/weft`). Sync is manual, per-release. The mirror strips
runtime-specific bindings so any consumer can `pnpm add weft-core` without
bringing in internal dependencies. The four shared concepts (`AgentUnit`,
`AgentUnitMetadata`, `WeftError`, `RetryOptions`) are contract-tested for
equivalence between canonical and mirror.

### What's coming

The `[Unreleased]` sections of the per-package changelogs track work in flight.
Key items landing in the next beta:

- Dynamic provider imports so only the provider in use must be installed (no
  `MODULE_NOT_FOUND` for optional peer dependencies).
- `Weft.configure()` wired through to `ai()` and provider detection so global
  config is actually consumed.
- API-key redaction hardened: all occurrences replaced, deep-sanitised
  `error.cause`.
- Provider-appropriate default models (Anthropic/Google users no longer receive
  OpenAI model strings).
- CLI fixes: case-sensitive binary resolution, `--version` reads real package
  version, template path safety.
- TaCo veto correctness, converge parallel-mode warnings, per-instance lock
  state.
- CI hardening: weft-pro test coverage in CI, pack-and-inspect validation for
  `workspace:*` peer dependency rewriting.

See each package's `CHANGELOG.md` under `[Unreleased]` for the full per-package
detail.

### Release schedule

Weft is pre-1.0. APIs may change between minor versions. Every breaking change
gets a changelog entry and a migration path in the release notes. Packages
version independently via Changesets; core and pro are currently pinned to the
same beta cadence (`linked` in `.changeset/config.json`).

[1.0.0-beta.1]: https://github.com/wefthq/weft/releases/tag/v1.0.0-beta.1
