---
"weft-convex": minor
"weft-testing": patch
---

**weft-convex**

- `withAI` throws when `trackCost` is supplied without `costContext.userId`, instead of recording cost against an undefined owner.

**weft-testing**

- The rehearsal engine re-exports `weft-core/rehearsal`, replacing a second copy that lacked the trace-integrity checks. Existing deep import paths keep resolving.
