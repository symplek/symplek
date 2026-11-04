# Changelog

## 0.2.0-beta.0

### Minor Changes

- 91ca43f: First public beta of the CLI. Its `create` wrapper is versioned alongside it and held back from npm.

  **@symplek/cli**
  - The code generators emit TypeScript that compiles against the real `@symplek/core` API. A compile gate in the test suite type-checks every generator path.
  - Requires Node `>=20.19`, the lowest version the package can start on.
  - `@symplek/core` is declared as a peer dependency, since generated code imports it.
  - `symplek init` no longer hangs while the package manager installs.
  - The binary resolves on case-sensitive filesystems (`symplek`, lowercase).
  - `symplek --version` reports the real package version.
  - The default project name is `my-symplek-project`, which passes the CLI's own name check in `--yes` mode.
  - YAML generation validates its inputs and escapes template values.
  - Every agent file the CLI scaffolds passes the CLI's own `validate` and `generate`. The templates used keys the validator rejected.
  - `validate` and `generate` accept any well-formed model id. The CLI no longer keeps its own list of which models exist, so a model released after the CLI still works.
  - `symplek add agent --type` is checked against the real list of types. The `typescript` type writes a TypeScript agent and no YAML file; it used to write TypeScript into the YAML file.
  - The test `symplek add agent` writes into your project runs your real agent and replaces only the model call. The old one mocked the agent and tested the mock.
  - Scaffolded projects depend on `zod` and on the CLI that created them, so `symplek generate` runs from inside the project.

  **create-symplek**
  - New package, not published in this release. The name `create-weft` belongs to someone else on npm, so the package is named `create-symplek` and stays marked private until a publishing decision is made.
  - A thin wrapper that runs `symplek init` from the `@symplek/cli` it depends on, started with the running Node binary and no shell, so it behaves the same on Windows, macOS and Linux. Its version is linked to `@symplek/cli`'s, so the two are bumped to the same number whenever they are released together.

### Patch Changes

- Updated dependencies [91ca43f]
  - @symplek/core@1.0.0-beta.2

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-XX-XX

### Added

- Initial release. `weft init` scaffolds minimal, standard, and full project templates.

[Unreleased]: https://github.com/wefthq/weft/compare/weft-cli@0.1.0...HEAD
[0.1.0]: https://github.com/wefthq/weft/releases/tag/weft-cli@0.1.0
