# create-symplek

Scaffolds a Symplek agent in 30 seconds.

```bash
npm create symplek@latest
```

That's it. The command drops you into an interactive setup and generates a
ready-to-run Symplek agent project — complete with retry, fallback, and testing.

## What it does

`create-symplek` is a thin wrapper. It forwards everything you pass to the Symplek
CLI's `init` command, so any flag the CLI understands works here too:

```bash
# Pick a template up front (minimal | standard | full)
npm create symplek@latest -- --template minimal

# Name the project directory
npm create symplek@latest my-agent
```

Equivalent to running the CLI directly:

```bash
npx -p @symplek/cli symplek init
```

## Other package managers

```bash
pnpm create symplek
yarn create symplek
bun create symplek
```

## Requirements

- Node.js >= 20

## License

MIT
