# create-weft

Scaffolds a Weft agent project. It is a thin wrapper around `weft init` from
[`weft-cli`](../weft-cli): it runs the copy of the CLI it depends on and hands
every argument straight through.

> **Not on npm under this name.** The npm name `create-weft` belongs to an
> unrelated project, so `npm create weft` does not run this package. Until this
> wrapper is published under a name of our own, scaffold with the CLI directly.

```bash
npx -p weft-cli weft init
```

## Options

Everything `weft init` accepts:

```bash
# Pick a template up front (minimal | standard | full)
npx -p weft-cli weft init --template minimal

# Name the project
npx -p weft-cli weft init --name my-agent

# Choose the package manager and skip the prompts
npx -p weft-cli weft init --name my-agent --pm pnpm --yes
```

## Requirements

- Node.js >= 20.19

## License

MIT
