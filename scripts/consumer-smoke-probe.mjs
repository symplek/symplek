// Runs inside the throwaway consumer project created by consumer-smoke.mjs.
// Loads every given specifier in one process, by `import` or `require`, and
// reports which loaded and whether any two of them carry their own copy of
// the same code.
//
// usage: node consumer-smoke-probe.mjs <esm|cjs> <specifier>...
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [mode, ...specs] = process.argv.slice(2);
const report = { entries: {}, names: {}, duplicates: [] };
const seen = new Map();

for (const spec of specs) {
  try {
    const mod = mode === "cjs" ? require(spec) : await import(spec);
    report.entries[spec] = `OK ${Object.keys(mod).length} exports`;
    // Bundler bookkeeping is not part of the public surface.
    report.names[spec] = Object.keys(mod)
      .filter((name) => !["default", "__esModule", "module.exports"].includes(name))
      .sort();
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      const source = String(value);
      const prior = seen.get(name) ?? [];
      for (const earlier of prior) {
        // Same name and same source text but a different object: the build
        // gave each entry point its own copy, so state set through one
        // (a registry, a class used for instanceof) is invisible to the other.
        if (earlier.value !== value && earlier.source === source && source.length > 40) {
          report.duplicates.push(`${name} (${earlier.spec} and ${spec})`);
        }
      }
      prior.push({ spec, value, source });
      seen.set(name, prior);
    }
  } catch (error) {
    report.entries[spec] = `FAIL ${String(error?.message).split("\n")[0].slice(0, 220)}`;
  }
}

console.log(JSON.stringify(report));
