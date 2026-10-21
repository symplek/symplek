# @symplek/convex

**Symplek Framework - Convex Integration**

> **Support Tier: EXPERIMENTAL** (0.1.0)
>
> This package provides Convex-specific wrappers that bridge Convex `ActionCtx`
> with `@symplek/core` AI primitives. It has no standalone consumer proof yet.

---

## What This Package Contains

`@symplek/convex` exports Convex action wrappers for the Symplek framework:

- `withAI(ctx, options)`: create an AI client bound to a Convex `ActionCtx`
- Middleware: activity logging and cost tracking via typed `FunctionReference` mutations
- Streaming: `streamToMutation()` for piping AI output into Convex mutations
- Types: `ConvexAIOptions`, `ConvexAI`

---

## Quick Start: minimal path (no middleware)

The simplest usage omits mutations entirely. Guards only fire when mutation refs are present.

```typescript
import { withAI } from "@symplek/convex";

export const myAction = internalAction({
  handler: async (ctx) => {
    const ai = withAI(ctx);                          // no mutations: no guards

    const result = await ai.generate("Summarize this project");
    return result;
  },
});
```

---

## With middleware (activity logging and cost tracking)

When you provide mutation refs, you **must** also provide the matching scope context.
Both guards throw at construction time: before any AI call: so misconfiguration is caught early.

```typescript
import { withAI } from "@symplek/convex";
import { internal } from "./_generated/api";

export const myAction = internalAction({
  args: { userId: v.string(), projectId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    const ai = withAI(ctx, {
      mutations: {
        logActivity: internal.ai.logActivity,   // requires activityContext
        trackCost: internal.ai.trackCost,        // requires costContext.userId
      },
      activityContext: { projectId: args.projectId, threadId: args.threadId },
      costContext: { userId: args.userId, projectId: args.projectId },
    });

    const result = await ai.generate("Summarize this project");
    return result;
  },
});
```

Guard behaviour:
- `mutations.logActivity` provided without `activityContext` → throws immediately
- `mutations.trackCost` provided without `costContext.userId` → throws immediately

---

## Supported API (Main Path)

| Method | Purpose |
|---|---|
| `generate(prompt)` | Generate text from a prompt |
| `streamToMutation(stream, config)` | Stream AI output to a Convex mutation |
| `raw` | Direct access to the `ai()` function from `@symplek/core` |

### Options (`ConvexAIOptions`)

```typescript
withAI(ctx, {
  mutations: {
    logActivity: internal.ai.logActivity,  // typed FunctionReference
    trackCost: internal.ai.trackCost,      // typed FunctionReference
  },
  logActivity: true,        // default: true when mutation provided
  trackCosts: true,         // default: true when mutation provided
  defaultModel: "gpt-4o",  // optional default model
  activityContext: { projectId, threadId },  // required with logActivity mutation
  costContext: { userId, projectId },         // userId required with trackCost mutation
});
```

The `mutations` field accepts explicit `FunctionReference` values: no more
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
| Upstream-app-specific types | Not part of this package's API surface: removed in Waves 1–3 |

---

## Requires

- `@symplek/core` as peer dependency
- `convex` ^1.19.0
- `zod` ^3.0.0 (**optional** - only for `experimental.generateTyped`)

## License

MIT
