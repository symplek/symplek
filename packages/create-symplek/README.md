# create-symplek

Scaffolds a Symplek agent project. It is a thin wrapper around `symplek init` from
[`@symplek/cli`](../symplek-cli): it runs the copy of the CLI it depends on and hands
every argument straight through.

> **Not on npm under this name.** The npm name `create-symplek` belongs to an
> unrelated project, so `npm create symplek` does not run this package. Until this
> wrapper is published under a name of our own, scaffold with the CLI directly.

```bash
npx -p @symplek/cli symplek init
```

## Options

Everything `symplek init` accepts:

```bash
# Pick a template up front (minimal | standard | full)
npx -p @symplek/cli symplek init --template minimal

# Name the project
npx -p @symplek/cli symplek init --name my-agent

# Choose the package manager and skip the prompts
npx -p @symplek/cli symplek init --name my-agent --pm pnpm --yes
```

## Requirements

- Node.js >= 20.19

## License

MIT
