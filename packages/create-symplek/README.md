# create-symplek

Scaffolds a Symplek agent project.

```bash
npx -p @symplek/cli symplek init
```

Or, if you have `@symplek/cli` installed globally:

```bash
symplek init
```

## What it does

`create-symplek` is a thin wrapper around the Symplek CLI's `init` command. It forwards
every flag you pass through, so any option the CLI understands works here too:

```bash
# Pick a template up front (minimal | standard | full)
npx -p @symplek/cli symplek init --template minimal

# Name the project directory
npx -p @symplek/cli symplek init my-agent
```

## Requirements

- Node.js >= 20.19

## License

MIT
