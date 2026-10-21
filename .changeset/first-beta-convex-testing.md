---
"@symplek/convex": minor
"@symplek/testing": patch
---

**@symplek/convex**

- `withAI` throws when `trackCost` is supplied without `costContext.userId`, instead of recording cost against an undefined owner.

**@symplek/testing**

- The rehearsal engine re-exports `@symplek/core/rehearsal`, replacing a second copy that lacked the trace-integrity checks. Existing deep import paths keep resolving.
