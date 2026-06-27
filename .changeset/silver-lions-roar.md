---
"weft-cli": patch
---

Fix binary resolution on case-sensitive filesystems (`bin.weft` → `./bin/weft.js`; was `Weft`). Read real package version at runtime for `weft --version` (was hardcoded `2.0.0`). Default project name changed to `my-weft-project` to pass kebab-case validation in `--yes` mode. Normalize project name to basename and reject path-separator characters. Switch template resolution from `__dirname` to `import.meta.url`. Cap `migrate` file scan and de-nest the regex to prevent pathological backtracking. Add `CHANGELOG.md` to published `files`.
