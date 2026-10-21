---
"@symplek/cli": minor
"create-symplek": minor
---

First public beta of the CLI. Its `create` wrapper is versioned alongside it and held back from npm.

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

- New package, not published in this release. The name `create-symplek` belongs to someone else on npm, so the package is marked private until it has a name of its own.
- A thin wrapper that runs `symplek init` from the `@symplek/cli` it depends on, started with the running Node binary and no shell, so it behaves the same on Windows, macOS and Linux. Its version moves with `@symplek/cli` so the two always match.
