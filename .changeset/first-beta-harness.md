---
"@symplek/harness": minor
---

- The built package loads in Node. Its relative imports carry file extensions; without them every entry point failed with `ERR_MODULE_NOT_FOUND`.
- Results from a stand-in session are stamped `source: "synthesized"` and never carry `verifiedBy`. Only a real session is stamped `source: "agent"`.
- Synthesised plans carry `synthesized: true` and heuristic confidences, so they cannot be read as execution records.
- `plan()` no longer double-wraps its result. `result.value.id` is where the documentation says it is.
- The first trace write creates the `traces/` directory. It used to fail when the directory did not exist.
- A run that fails still leaves its trace, without the closing `SessionEnd` line. Each entry carries the time its event happened.
- `ReplayAdapter` replays the run a trace file ends with and refuses, with `ReplayIncompleteError`, a trace that is empty or whose last run did not complete. It used to replay a failed run as a finished one with an empty result.
- The permission bridge fails closed. A tool it does not recognise is refused, every path argument on a call is checked, and absolute paths are rejected, in requests and in the plan itself. An ordinary search still goes through: the regular expression a search matches against file contents is not treated as a path, and a glob is accepted in a plain form only (names that may hold `*` and `?`, single dots between names, `/` between segments). A plain glob cannot spell a path outside its search root; whether a wildcard can match `.` or `..`, and whether links are followed, is down to the search engine, and the README says what is assumed. Braces and character classes in a glob are refused.
- `WebSearch` and `WebFetch` are allowed when the plan lists them. The bridge does not gate network access.
