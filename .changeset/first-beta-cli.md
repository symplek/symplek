---
"weft-cli": minor
"create-weft": minor
---

First public beta of the CLI. Its `create` wrapper is versioned alongside it and held back from npm.

**weft-cli**

- The code generators emit TypeScript that compiles against the real `weft-core` API. A compile gate in the test suite type-checks every generator path.
- Requires Node `>=20.19`, the lowest version the package can start on.
- `weft-core` is declared as a peer dependency, since generated code imports it.
- `weft init` no longer hangs while the package manager installs.
- The binary resolves on case-sensitive filesystems (`weft`, lowercase).
- `weft --version` reports the real package version.
- The default project name is `my-weft-project`, which passes the CLI's own name check in `--yes` mode.
- YAML generation validates its inputs and escapes template values.
- Every agent file the CLI scaffolds passes the CLI's own `validate` and `generate`. The templates used keys the validator rejected.
- `validate` and `generate` accept any well-formed model id. The CLI no longer keeps its own list of which models exist, so a model released after the CLI still works.
- `weft add agent --type` is checked against the real list of types. The `typescript` type writes a TypeScript agent and no YAML file; it used to write TypeScript into the YAML file.
- The test `weft add agent` writes into your project runs your real agent and replaces only the model call. The old one mocked the agent and tested the mock.
- Scaffolded projects depend on `zod` and on the CLI that created them, so `weft generate` runs from inside the project.

**create-weft**

- New package, not published in this release. The name `create-weft` belongs to someone else on npm, so the package is marked private until it has a name of its own.
- A thin wrapper that runs `weft init` from the `weft-cli` it depends on, started with the running Node binary and no shell, so it behaves the same on Windows, macOS and Linux. Its version is linked to `weft-cli`'s, so the two are bumped to the same number whenever they are released together.
