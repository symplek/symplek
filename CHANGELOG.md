# Changelog

All notable changes to the Symplek monorepo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-package changelogs live in each package directory (`packages/*/CHANGELOG.md`). This file
covers the monorepo as a whole: cross-cutting changes, new packages, breaking renames, and
release-coordination notes.

## [1.0.0-beta.1] - 2026-04-13

### What is Symplek?

Symplek is a set of composable agent primitives for TypeScript. It replaces
hand-rolled coordination scaffolding — promise chains, retry loops, consensus
aggregation, result tracking — with a small algebra centred on `AgentUnit<T>`.
The same coordination patterns (retry, timeout, fallback, parallel consensus,
iterative refinement) compose as method chains on a single type.

Symplek was extracted from a real product. The API was shaped by actual usage, not
by imagining what developers might want. The core is 25 KB, MIT-licensed, with
zero required peer dependencies beyond the AI provider SDK you already use.

### What's included

- **`@symplek/core`** (MIT) — The `AgentUnit` algebra: composition, resilience,
  coordination, reliability, and observability operators. Provider adapters for
  OpenAI, Anthropic, and Google. The `Symplek` namespace facade for single-prompt
  work and streaming. Golden-path test suite with 25 passing tests.

- **`@symplek/pro`** (BSL 1.1) — Advanced multi-agent coordination: TaCo consensus
  (multi-round iterative voting), team coordination via `TeamRegistry`,
  stigmergy-based collaboration, antibody registry for output quality, trust
  registry for scan-depth control, and standalone confidence/coherence scoring
  libraries. Contract test suite.

- **`@symplek/react`** (MIT) — React hooks for streaming (`useSymplekStream`) and error
  boundaries (`AIErrorBoundary`).

- **`@symplek/convex`** (MIT) — First-class Convex action bindings wrapping
  `@symplek/core/server`.

- **`@symplek/cli`** (MIT) — Project scaffolding (`symplek init`) with minimal,
  standard, and full templates.

- **`@symplek/mcp`** (MIT) — MCP server exposing Symplek operations as tool calls.

- **`@symplek/harness`** (MIT) — Replay, rehearse, fault injection, and
  determinism-assertion utilities for testing agent compositions.

- **`@symplek/testing`** (MIT) — Vitest utilities, mock factories, and deterministic
  provider stubs.

- **`@symplek/devtools`** (MIT) — Chrome DevTools bridge for agent trace and span
  inspection.

### Breaking rename: `@symplek/*` → `@symplek/*`

Packages moved from the `@symplek/*` npm scope to unscoped `@symplek/*` names. All
imports, install commands, and documentation now use `@symplek/core`, `@symplek/pro`,
etc. The old `@symplek/*` packages do not exist on npm.

### Architecture

Symplek has a canonical source (private upstream monorepo) and this distribution
mirror (`symplek/symplek`). Sync is manual, per-release. The mirror strips
runtime-specific bindings so any consumer can `pnpm add @symplek/core` without
bringing in internal dependencies. The four shared concepts (`AgentUnit`,
`AgentUnitMetadata`, `SymplekError`, `RetryOptions`) are contract-tested for
equivalence between canonical and mirror.

### What's coming

The `[Unreleased]` sections of the per-package changelogs track work in flight.
Key items landing in the next beta:

- Dynamic provider imports so only the provider in use must be installed (no
  `MODULE_NOT_FOUND` for optional peer dependencies).
- `Symplek.configure()` wired through to `ai()` and provider detection so global
  config is actually consumed.
- API-key redaction hardened: all occurrences replaced, deep-sanitised
  `error.cause`.
- Provider-appropriate default models (Anthropic/Google users no longer receive
  OpenAI model strings).
- CLI fixes: case-sensitive binary resolution, `--version` reads real package
  version, template path safety.
- TaCo veto correctness, converge parallel-mode warnings, per-instance lock
  state.
- CI hardening: @symplek/pro test coverage in CI, pack-and-inspect validation for
  `workspace:*` peer dependency rewriting.

See each package's `CHANGELOG.md` under `[Unreleased]` for the full per-package
detail.

### Release schedule

Symplek is pre-1.0. APIs may change between minor versions. Every breaking change
gets a changelog entry and a migration path in the release notes. Packages
version independently via Changesets; core and pro are currently pinned to the
same beta cadence (`linked` in `.changeset/config.json`).

[1.0.0-beta.1]: https://github.com/symplek/symplek/releases/tag/v1.0.0-beta.1
