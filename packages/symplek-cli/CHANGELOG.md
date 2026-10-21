# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Binary now resolves on case-sensitive filesystems: `bin` is `symplek` → `./bin/symplek.js` (was `Symplek`).
- `symplek --version` reads the real package version (was hardcoded `2.0.0`).
- Default project name is `my-symplek-project`, valid under the kebab-case check in `--yes` mode.
- Project name is normalized to a basename and rejected if it contains path separators.

### Changed

- Template resolution uses `import.meta.url` instead of `__dirname`.
- `migrate` file scan is size-capped and the regex de-nested to avoid pathological backtracking.

## [0.1.0] - 2026-XX-XX

### Added

- Initial release. `symplek init` scaffolds minimal, standard, and full project templates.

[Unreleased]: https://github.com/symplek/symplek/compare/@symplek/cli@0.1.0...HEAD
[0.1.0]: https://github.com/symplek/symplek/releases/tag/@symplek/cli@0.1.0
