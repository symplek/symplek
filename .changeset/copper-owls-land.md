---
"@symplek/pro": patch
---

Add `test` script (`vitest run`) so standard CI (`pnpm test`) runs the contract suite instead of silently skipping the package. Guard `converge` parallel last-writer-wins semantics with documentation and a warning. Isolate in-memory lock state to per-instance scope instead of a process-global singleton.
