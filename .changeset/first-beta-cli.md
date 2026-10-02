---
"weft-cli": minor
"create-weft": minor
---

First public beta of the CLI and its `create` wrapper.

**weft-cli**

- The code generators emit TypeScript that compiles against the real `weft-core` API. A compile gate in the test suite type-checks every generator path.
- Requires Node `>=20.19`, the lowest version the package can start on.
- `weft-core` is declared as a peer dependency, since generated code imports it.
- `weft init` no longer hangs while the package manager installs.
- The binary resolves on case-sensitive filesystems (`weft`, lowercase).
- `weft --version` reports the real package version.
- The default project name is `my-weft-project`, which passes the CLI's own name check in `--yes` mode.
- YAML generation validates its inputs and escapes template values.

**create-weft**

- New package. A thin wrapper that runs the `weft-cli` release of the same version, without spawning a shell. It is released together with `weft-cli` so the two versions always match.
