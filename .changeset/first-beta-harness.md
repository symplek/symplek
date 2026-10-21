---
"@symplek/harness": minor
---

- The built package loads in Node. Its relative imports carry file extensions; without them every entry point failed with `ERR_MODULE_NOT_FOUND`.
- Results from a stand-in session are stamped `source: "synthesized"` and never carry `verifiedBy`. Only a real session is stamped `source: "agent"`.
- Synthesised plans carry `synthesized: true` and heuristic confidences, so they cannot be read as execution records.
- `plan()` no longer double-wraps its result. `result.value.id` is where the documentation says it is.
- The first trace write creates the `traces/` directory. It used to fail when the directory did not exist.
