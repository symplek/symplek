---
"@symplek/harness": minor
---

- Results from the stub session are stamped `source: "synthesized"`. Only a real execution is stamped `"verified"`.
- Synthesised plans carry `synthesized: true` and heuristic confidences, so they cannot be read as execution records.
- `plan()` no longer double-wraps its result. `result.value.id` is where the documentation says it is.
