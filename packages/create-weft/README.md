# create-weft

Scaffolds a Weft agent in 30 seconds.

```bash
npm create weft@latest
```

That's it. The command drops you into an interactive setup and generates a
ready-to-run Weft agent project — complete with rehearsal/replay examples.

## What it does

`create-weft` is a thin wrapper. It forwards everything you pass to the Weft
CLI's `init` command, so any flag the CLI understands works here too:

```bash
# Pick a template up front (minimal | standard | full)
npm create weft@latest -- --template minimal

# Name the project directory
npm create weft@latest my-agent
```

Equivalent to running the CLI directly:

```bash
npx -p weft-cli weft init
```

## Other package managers

```bash
pnpm create weft
yarn create weft
bun create weft
```

## Requirements

- Node.js >= 20

## License

MIT
