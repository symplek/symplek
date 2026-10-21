---
"@symplek/cli": minor
"create-symplek": minor
---

First public beta of the CLI and its `create` wrapper.

**@symplek/cli**

- The code generators emit TypeScript that compiles against the real `@symplek/core` API. A compile gate in the test suite type-checks every generator path.
- Requires Node `>=20.19`, the lowest version the package can start on.
- `@symplek/core` is declared as a peer dependency, since generated code imports it.
- `symplek init` no longer hangs while the package manager installs.
- The binary resolves on case-sensitive filesystems (`symplek`, lowercase).
- `symplek --version` reports the real package version.
- The default project name is `my-symplek-project`, which passes the CLI's own name check in `--yes` mode.
- YAML generation validates its inputs and escapes template values.

**create-symplek**

- New package. A thin wrapper that runs the `@symplek/cli` release of the same version, without spawning a shell. It is released together with `@symplek/cli` so the two versions always match.
