# Symplek

> Composable AI agents for TypeScript. A pnpm monorepo of `@symplek/*` packages (Node ≥20, changesets for releases).

This project uses the shared Claude Code framework. Framework files (.claude/hooks, rules, skills,
agents, commands, docs, scripts) are symlinked from the central clone. Project-specific configuration
lives here.

See `.claude/config.json` for project-specific feature toggles (Convex, Symplek, WorkOS, BMAD, etc.).

## Monorepo layout

Packages live under `packages/`:

- `@symplek/core` — provider integration + streaming primitives (Anthropic, OpenAI, Google, auto)
- `@symplek/pro` — operators, solo locks, convergence/merge strategies
- `@symplek/cli`, `@symplek/convex`, `@symplek/devtools`, `@symplek/harness`, `@symplek/mcp`, `@symplek/react`, `@symplek/testing`

Workspace scripts (run from root): `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`. Filter is `@symplek/*`. Releases go through `pnpm changeset` → `version-packages` → `release`.

---

## Stack

Declare your project's technology stack in `.claude/config.json` under `techStack`. Example:

```json
{
  "techStack": "React 19, TanStack Router, Convex, Tailwind, Vitest"
}
```

Agents use this to tailor suggestions, lint rules, and review criteria.

---

## Auth

Declare your auth setup in `.claude/config.json` under `authSetup`. Example:

```json
{
  "authSetup": "WorkOS AuthKit + Convex custom JWT. Auth context via React provider. Unauth redirect to /sign-in."
}
```

---

## Project-specific rules

Add any rules that apply only to this project here. For example:

- Naming conventions specific to this codebase
- Which routes require authentication
- Data-model invariants agents must respect

---

## Framework docs

The full framework guide lives at:

```
<framework_root>/.claude/docs/
```

Key entry points:
- `docs/guides/` — workflow guides (build, check, fix, deploy)
- `docs/reference/config-schema.md` — all `.claude/config.json` keys
- `docs/reference/` — deep dives on individual framework subsystems
