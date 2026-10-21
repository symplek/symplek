# @symplek/cli

Symplek CLI - AI Agent Development Toolkit

## Installation

```bash
# Global install
npm install -g @symplek/cli

# Or use npx
npx @symplek/cli --help
```

## Usage

```bash
# Display help
symplek --help

# Display version
symplek --version

# Initialize a new Symplek project
symplek init

# Add agents, tools, or workflows
symplek add agent my-agent

# Validate YAML agent definitions
symplek validate agents/

# Migrate existing agent definitions
symplek migrate

# Generate TypeScript from YAML
symplek generate
```

## Commands

| Command | Description | Status |
|---------|-------------|--------|
| `symplek --help` | Display help information | ✅ Available |
| `symplek --version` | Display CLI version | ✅ Available |
| `symplek init` | Initialize a new Symplek project | ✅ Available |
| `symplek add` | Add agents, tools, or workflows | ✅ Available |
| `symplek validate` | Validate YAML definitions | ✅ Available |
| `symplek migrate` | Migrate existing agent definitions | ✅ Available |
| `symplek generate` | Generate TypeScript from YAML | ✅ Available |

## Requirements

- Node.js >= 20.19
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
