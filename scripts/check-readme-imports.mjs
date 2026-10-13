#!/usr/bin/env node
/**
 * Docs-are-tests check. Fails when a README or doc tells a reader to import
 * something a built workspace package does not export.
 *
 * For every fenced code block in the root README, each package README and
 * docs/*.md, it reads the import/require statements that name a workspace
 * package and checks, against that package's BUILT type declarations:
 *   - the subpath is in the package's `exports` map
 *   - every named (and default) import is really exported from it
 * It also checks that any `node_modules/<workspace-pkg>/<path>` a document
 * points at is a file the package builds and publishes.
 *
 * Run after `pnpm build`:  node scripts/check-readme-imports.mjs
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(repo, "packages");

const workspace = new Map();
for (const dir of readdirSync(packagesDir)) {
  const file = path.join(packagesDir, dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  workspace.set(pkg.name, { dir: path.join(packagesDir, dir), pkg });
}

// TypeScript is a devDependency of the packages, not of the root.
const tsHost = [...workspace.values()].find((w) => existsSync(path.join(w.dir, "node_modules", "typescript")));
if (!tsHost) {
  console.error("check-readme-imports: typescript not installed; run `pnpm install` first.");
  process.exit(2);
}
const ts = createRequire(path.join(tsHost.dir, "package.json"))("typescript");

const documents = [path.join(repo, "README.md")];
for (const { dir } of workspace.values()) {
  const readme = path.join(dir, "README.md");
  if (existsSync(readme)) documents.push(readme);
}
const docsDir = path.join(repo, "docs");
if (existsSync(docsDir)) {
  for (const f of readdirSync(docsDir)) if (f.endsWith(".md")) documents.push(path.join(docsDir, f));
}

/**
 * Specifiers that look like one of ours. One of these that is not a workspace
 * package is a stale name (an old scope, a renamed package), which is the
 * most likely way for a doc to rot.
 */
// The old Weft names stay in the pattern: a rename leaves stale imports behind, and those must still be caught.
const LOOKS_LIKE_OURS = /^(@symplek\/|symplek$|symplek[-/]|create-symplek($|\/)|@weft\/|weft$|weft[-/]|create-weft($|\/))/;

/** Split a specifier into the workspace package it names and the subpath. */
function splitSpecifier(spec) {
  for (const name of workspace.keys()) {
    if (spec === name) return { name, sub: "." };
    if (spec.startsWith(`${name}/`)) return { name, sub: `./${spec.slice(name.length + 1)}` };
  }
  return null;
}

/** The declaration file a subpath resolves to, or a reason it does not resolve. */
function typesFor(name, sub) {
  const { dir, pkg } = workspace.get(name);
  const exp = pkg.exports;
  const hasSubpathMap = exp && typeof exp === "object" && Object.keys(exp).some((k) => k.startsWith("."));
  let types;
  if (hasSubpathMap) {
    const target = exp[sub];
    if (target === undefined) return { error: `"${sub}" is not in ${name}'s exports map` };
    const pick = (t) => (typeof t === "string" ? undefined : (t.types ?? pick(t.import ?? t.require ?? t.default ?? "")));
    types = pick(target);
  } else if (sub === ".") {
    types = pkg.types ?? pkg.typings;
  } else {
    // No exports map: any file path resolves. Only its existence can be checked.
    const file = path.join(dir, sub);
    return existsSync(file) || existsSync(`${file}.js`) ? { skip: true } : { error: `${name}/${sub.slice(2)} does not exist` };
  }
  if (!types) return { skip: true };
  const file = path.join(dir, types);
  if (!existsSync(file)) return { error: `${name} is not built (${types} missing); run \`pnpm build\`` };
  return { file };
}

const exportCache = new Map();
function exportedNames(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  const names = new Set(symbol ? checker.getExportsOfModule(symbol).map((s) => s.name) : []);
  exportCache.set(file, names);
  return names;
}

const CODE_LANGS = new Set(["ts", "tsx", "typescript", "js", "jsx", "javascript", "mjs", "cjs"]);
const errors = [];
let checked = 0;

for (const doc of documents) {
  const text = readFileSync(doc, "utf8");
  const rel = path.relative(repo, doc).replace(/\\/g, "/");
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const fail = (index, message) => errors.push(`${rel}:${lineOf(index)}  ${message}`);

  // Paths into an installed copy of a workspace package, anywhere in the document.
  for (const m of text.matchAll(/node_modules\/([@\w./-]+)/g)) {
    const hit = splitSpecifier(m[1]);
    if (!hit || hit.sub === ".") continue;
    checked++;
    const { dir, pkg } = workspace.get(hit.name);
    const target = hit.sub.slice(2).replace(/[.,;:)]+$/, "");
    const top = target.split("/")[0];
    const published = !pkg.files || pkg.files.some((f) => f.replace(/^\.\//, "").split("/")[0] === top);
    if (!existsSync(path.join(dir, target))) fail(m.index, `points at ${hit.name}/${target}, which the build does not produce`);
    else if (!published) fail(m.index, `points at ${hit.name}/${target}, which is not in the package's published files`);
  }

  for (const block of text.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)) {
    if (!CODE_LANGS.has(block[1].toLowerCase())) continue;
    // Comments are blanked out (kept at the same length, so positions still
    // map to the right line): a comment inside an import clause would
    // otherwise hide the whole statement from the patterns below.
    const code = block[2].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
    const base = block.index + block[0].indexOf(code);
    const statements = [
      // import [type] <clause> from "spec"   /   export <clause> from "spec"
      ...[...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^;'"]*?)\s+from\s+["']([^"']+)["']/g)].map((m) => ({
        index: m.index,
        clause: m[1],
        spec: m[2],
      })),
      // import "spec"   /   require("spec")   /   import("spec")
      ...[...code.matchAll(/\b(?:import\s*|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => ({
        index: m.index,
        clause: "",
        spec: m[1],
      })),
      // const { a, b } = require("spec")
      ...[...code.matchAll(/\{([^}]*)\}\s*=\s*(?:await\s+import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => ({
        index: m.index,
        clause: `{${m[1].replace(/:\s*\w+/g, "")}}`,
        spec: m[2],
      })),
    ];
    for (const { index, clause, spec } of statements) {
      const hit = splitSpecifier(spec);
      if (!hit) {
        if (LOOKS_LIKE_OURS.test(spec)) {
          checked++;
          fail(base + index, `import from "${spec}": no package in this workspace has that name`);
        }
        continue;
      }
      checked++;
      const resolved = typesFor(hit.name, hit.sub);
      if (resolved.error) {
        fail(base + index, `import from "${spec}": ${resolved.error}`);
        continue;
      }
      if (resolved.skip || !clause) continue;
      const names = exportedNames(resolved.file);
      const wanted = [];
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces) {
        for (const part of braces[1].split(",")) {
          const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
          if (name) wanted.push(name);
        }
      }
      const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/\*\s+as\s+\w+/, "").replace(/,/g, "").trim();
      if (outside && outside !== "*") wanted.push("default");
      for (const name of wanted) {
        if (!names.has(name)) fail(base + index, `"${spec}" does not export ${name === "default" ? "a default" : `\`${name}\``}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`check-readme-imports: ${errors.length} problem(s) in ${documents.length} documents\n`);
  for (const e of [...new Set(errors)]) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-readme-imports: OK (${checked} references in ${documents.length} documents)`);
