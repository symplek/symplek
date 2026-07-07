#!/usr/bin/env node
// ⚠️ FATAL #5 FIX (2026-07-07): CLI split from library entry.
// dist/cli.js calls program.parse() — safe because it's only loaded via bin.
// dist/index.js is library-only — safe for programmatic imports.
require("../dist/cli.js");
