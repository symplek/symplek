# weft-convex

**Weft Framework - Convex Integration**

> **Support Tier: EXPERIMENTAL** (0.1.0)
>
> This package provides Convex-specific wrappers that bridge Convex `ActionCtx`
> with `weft-core` AI primitives. It has no standalone consumer proof yet.
>
> For Convex actions that need the full feature set (context builder, memory bootstrap, tracing),
> use the internal spine directly: `convex/lib/agent_framework/` with `buildContext(actionCtx)`.

---

## What This Package Contains

`weft-convex` exports Convex action wrappers for the Weft framework:

- `withAI(ctx, options)` — create an AI client bound to a Convex `ActionCtx`
- Middleware: activity logging and cost tracking via typed `FunctionReference` mutations
- Streaming: `streamToMutation()` for piping AI output into Convex mutations
- Types: `WeftConvexOptions`, `WeftConvexClient`

---

## Quick Start

```typescript
import { withAI } from "weft-convex";
import { internal } from "./_generated/api";

export const myAction = internalAction({
  handler: async (ctx) => {
    const ai = withAI(ctx, {
      mutations: {
        logActivity: internal.ai.logActivity,
        trackCost: internal.ai.trackCost,
      },
    });

    const result = await ai.generate("Summarize this project");
    return result;
  },
});
```

## Supported API (Main Path)

| Method | Purpose |
|---|---|
| `generate(prompt)` | Generate text from a prompt |
| `streamToMutation(stream, config)` | Stream AI output to a Convex mutation |
| `raw` | Direct access to the `ai()` function from `weft-core` |

### Options

```typescript
withAI(ctx, {
  mutations: {
    logActivity: internal.ai.logActivity,  // typed FunctionReference
    trackCost: internal.ai.trackCost,      // typed FunctionReference
  },
  logActivity: true,        // default: true when mutation provided
  trackCosts: true,         // default: true when mutation provided
  defaultModel: "gpt-4o",  // optional default model
  activityContext: { projectId, threadId },
  costContext: { userId, projectId },
});
```

The `mutations` field accepts explicit `FunctionReference` values - no more
`internalApi: any` object. If a mutation ref is not provided, the corresponding
middleware is silently skipped.

---

## Experimental Helpers

Experimental methods live under the `experimental` namespace and are **not part
of the supported API contract**. They may change or be removed without notice.

```typescript
const ai = withAI(ctx);

// Requires `zod` peer dependency - NOT part of the supported contract
const result = await ai.experimental.generateTyped("Create data", zodSchema);
```

---

## What Is NOT Supported

| Surface | Status |
|---|---|
| `experimental.generateTyped()` | Requires Zod peer - stability not guaranteed |
| Activity logging to Convex tables | Exists but no production proof |
| Cost tracking | Exists but no production proof |
| `streamToMutation()` | Exists but no production proof |
| Upstream-app-specific types | Not part of this package's API surface — removed in Waves 1–3 |

---

## Requires

- `weft-core` as peer dependency
- `convex` ^1.19.0
- `zod` ^3.0.0 (**optional** - only for `experimental.generateTyped`)

## License

MIT
