# weft-cli

Weft CLI - AI Agent Development Toolkit

## Installation

```bash
# Global install
npm install -g weft-cli

# Or use npx
npx weft-cli --help
```

## Usage

```bash
# Display help
weft --help

# Display version
weft --version

# Initialize a new Weft project
weft init

# Add agents, tools, or workflows
weft add agent my-agent

# Validate YAML agent definitions
weft validate agents/

# Migrate existing agent definitions
weft migrate

# Generate TypeScript from YAML
weft generate
```

## Commands

| Command | Description | Status |
|---------|-------------|--------|
| `weft --help` | Display help information | ✅ Available |
| `weft --version` | Display CLI version | ✅ Available |
| `weft init` | Initialize a new Weft project | ✅ Available |
| `weft add` | Add agents, tools, or workflows | ✅ Available |
| `weft validate` | Validate YAML definitions | ✅ Available |
| `weft migrate` | Migrate existing agent definitions | ✅ Available |
| `weft generate` | Generate TypeScript from YAML | ✅ Available |

## Requirements

- Node.js >= 18.0.0
- npm, pnpm, yarn, or bun

## Development

```bash
# Build the CLI
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## License

MIT
