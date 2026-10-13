---
"weft-convex": minor
"weft-testing": patch
---

**weft-convex**

- `withAI` throws at construction when a mutation that writes per-user data has no scope: `mutations.trackCost` without `costContext.userId`, or `mutations.logActivity` without `activityContext`. Before, the record was written against an undefined owner.
- The README's quick start runs as written. The type names it lists are the ones the package exports (`ConvexAI`, `ConvexAIOptions`).
- `weft-core` is a caret peer range, and each module format has its own type declarations.

**weft-testing**

- The package re-exports the rehearsal engine from `weft-core/rehearsal`, replacing a second copy that lacked the trace-integrity checks. It has one entry point, `weft-testing`.
- The README documents the functions the package exports. It used to describe several that did not exist.
