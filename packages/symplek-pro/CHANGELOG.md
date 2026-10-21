# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `test` script (`vitest run`) so `pnpm test` runs the contract suite and CI no longer silently skips this package.

### Fixed

- `converge` parallel last-writer-wins semantics are documented and guarded with a runtime warning so callers are not silently surprised.
- In-memory lock state (`solo/lock.ts`) is now per-instance rather than a process-global singleton, eliminating state leakage across unrelated operations and tests.

## [1.0.0-beta.1] - 2026-04-13

### Added

- **OC-0**: Initial extraction of **TaCo consensus** (`tacoConsensus`), **teams coordination** (`Team`, `TeamRegistry`), **stigmergy** (`ConfidentStigmergyLayer`), and **antibodies** (`AntibodyRegistry`) from Convex source into `@symplek/pro`.
- **OC-0**: Tier boundary established — `@symplek/pro` imports `@symplek/core` as a peer dependency; no circular references.
- **OC-0**: **Observability** module (`observable`, `getTraces`) for in-memory span tracing and cost tracking.
- **OC-0**: **Trust registry** (`TrustRegistry`) for trusted-traveler lanes and per-agent scan-depth control.
- **OC-0**: **Change-kernel** for approval workflows, escalation, merge, and classification.
- **OC-0**: **Coherence/Confidence standalone libraries** (variance, entropy, composite) for advanced compositions.
- **OC-1**: Quickstart documentation covering TaCo consensus and team coordination patterns.
- **OC-1**: Integration with Symplek namespace facade (`Symplek.configure`, `Symplek.providers`) from `@symplek/core`.
- **OC-1**: Golden-path test suite with 10 passing tests covering TaCo and team workflows.
- **OC-2 PKG**: Package metadata complete for npm discoverability (`keywords`, `description`, `engines`).
- **OC-2 DX**: `SymplekError` messages include `[symplek@VERSION]` prefix for self-identifying stack traces (inherited from `@symplek/core`).

[Unreleased]: https://github.com/symplek/symplek/compare/@symplek/pro@1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/symplek/symplek/releases/tag/@symplek/pro@1.0.0-beta.1
