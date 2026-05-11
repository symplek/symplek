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
Weft --help

# Display version
Weft --version

# Initialize a new Weft project (coming soon)
Weft init

# Add agents, tools, or workflows (coming soon)
Weft add agent my-agent

# Validate YAML agent definitions (coming soon)
Weft validate agents/

# Generate TypeScript from YAML (coming soon)
Weft generate
```

## Commands

| Command | Description | Status |
|---------|-------------|--------|
| `Weft --help` | Display help information | ✅ Available |
| `Weft --version` | Display CLI version | ✅ Available |
| `Weft init` | Initialize a new Weft project | 🚧 Coming in 03.02 |
| `Weft add` | Add agents, tools, or workflows | 🚧 Coming in 03.03 |
| `Weft validate` | Validate YAML definitions | 🚧 Coming in 03.04 |
| `Weft generate` | Generate TypeScript from YAML | 🚧 Coming in 03.05 |

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
