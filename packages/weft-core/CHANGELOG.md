# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `weft-core/server` imports provider SDKs dynamically so only the provider in use must be installed (no `MODULE_NOT_FOUND` for optional peer deps).
- Schema generic is threaded through the builder so `TrackedResult<T>` retains its inferred type through `ai()` calls with a schema.

### Fixed

- `Weft.configure()` global config (`provider`/`model`/`apiKey`/`debug`) is now consumed by `ai()` and provider detection (was a silent no-op).
- API key no longer leaks through the retained raw `error.cause`; the cause is deep-sanitised before attachment.
- API-key redaction replaces all occurrences in a string, not just the first.
- `selectModelForTask()` returns provider-appropriate default models (Anthropic/Google users no longer receive OpenAI model strings).
- Anthropic streaming usage metadata is recovered from `textDelta` chunks; token totals are now accurate.

### Changed

- `operators.ts` split into domain sub-modules to stay below the 1000-LOC absolute ceiling (rule 039).

## [1.0.0-beta.1] - 2026-04-13

### Added

- **OC-0**: Initial package structure with AgentUnit algebra extracted from Convex source.
- **OC-0**: Tier boundary enforcement separating open-core surfaces from Convex-internal code.
- **OC-1**: Weft namespace facade (`Weft.stream`, `Weft.agent`, `Weft.configure`, `Weft.providers`).
- **OC-1**: WeftBuilder and AgentBuilder connected to the public API.
- **OC-1**: Golden-path test suite with 25 passing tests.
- **OC-1**: Quickstart documentation.
- **OC-2 DX**: `WeftError` messages include `[weft@VERSION]` prefix for self-identifying stack traces.
- **OC-2 DX**: Debug mode (`ai.debug = true`) logs one-line trace per AI call to stderr.
- **OC-2 DX**: Provider adapters surface missing API key as `WeftError` with `code: PROVIDER_ERROR`, `why`, `fix`, and `example` fields.
- **OC-2 DX**: JSDoc `@example`, `@param`, `@returns` added to all public `AgentUnit` methods and exported functions.
- **OC-2 PKG**: Package metadata complete for npm discoverability (`keywords`, `description`, `engines`).

### Changed

- **OC-0**: Import path cleanup for published package layout and consumer ergonomics.

[Unreleased]: https://github.com/wefthq/weft/compare/weft-core@1.0.0-beta.1...HEAD
[1.0.0-beta.1]: https://github.com/wefthq/weft/releases/tag/weft-core@1.0.0-beta.1
