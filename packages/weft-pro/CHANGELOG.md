# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-beta.1] - 2026-04-13

### Added

- **OC-0**: Initial extraction of **TaCo consensus** (`tacoConsensus`), **teams coordination** (`Team`, `TeamRegistry`), **stigmergy** (`ConfidentStigmergyLayer`), and **antibodies** (`AntibodyRegistry`) from Convex source into `@weft/pro`.
- **OC-0**: Tier boundary established — `@weft/pro` imports `@weft/core` as a peer dependency; no circular references.
- **OC-0**: **Observability** module (`observable`, `getTraces`) for in-memory span tracing and cost tracking.
- **OC-0**: **Trust registry** (`TrustRegistry`) for trusted-traveler lanes and per-agent scan-depth control.
- **OC-0**: **Change-kernel** for approval workflows, escalation, merge, and classification.
- **OC-0**: **Coherence/Confidence standalone libraries** (variance, entropy, composite) for advanced compositions.
- **OC-1**: Quickstart documentation covering TaCo consensus and team coordination patterns.
- **OC-1**: Integration with Weft namespace facade (`Weft.configure`, `Weft.providers`) from `@weft/core`.
- **OC-1**: Golden-path test suite with 10 passing tests covering TaCo and team workflows.
- **OC-2 PKG**: Package metadata complete for npm discoverability (`keywords`, `description`, `engines`).
- **OC-2 DX**: `WeftError` messages include `[weft@VERSION]` prefix for self-identifying stack traces (inherited from `@weft/core`).

[Unreleased]: https://github.com/aWeft13/Weft/compare/@weft/pro@1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/aWeft13/Weft/releases/tag/@weft/pro@1.0.0-beta.1
