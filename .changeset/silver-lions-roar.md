---
"@symplek/cli": patch
---

Fix binary resolution on case-sensitive filesystems (`bin.symplek` → `./bin/symplek.js`; was `Symplek`). Read real package version at runtime for `symplek --version` (was hardcoded `2.0.0`). Default project name changed to `my-symplek-project` to pass kebab-case validation in `--yes` mode. Normalize project name to basename and reject path-separator characters. Switch template resolution from `__dirname` to `import.meta.url`. Cap `migrate` file scan and de-nest the regex to prevent pathological backtracking. Add `CHANGELOG.md` to published `files`.
