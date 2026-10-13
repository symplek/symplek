#!/usr/bin/env node
/**
 * Consumer smoke test. Proves the packages work the way a user receives them,
 * which the unit tests cannot: those run against source through aliases.
 *
 * It packs every publishable workspace package with `pnpm pack` (as
 * `changeset publish` does), installs the tarballs into a fresh project
 * outside the workspace, and then checks each installed package:
 *   - no `workspace:` specifier survived into the packed package.json
 *   - every main / types / exports / bin target is a file in the tarball
 *   - a LICENSE file is included
 *   - every entry in the exports map loads, by `import` and by `require`
 *   - entry points share one copy of the code (no duplicated singletons)
 *   - `import` and `require` of the same entry expose the same names
 *   - a package that needs an environment variable to load refuses to load
 *     without it
 *   - every bin parses, and answers `--help` without hanging
 *
 * Nothing is published. The registry is used for third-party dependencies
 * only: every workspace package is forced onto its local tarball.
 *
 * Run after `pnpm build`:  node scripts/consumer-smoke.mjs [work-dir] [repo-root]
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// A second argument points the check at another checkout of this repository.
const repo = path.resolve(process.argv[3] ?? path.join(here, ".."));
// The default lives in the OS temp dir: a project inside the repo would be
// treated as part of the workspace, and a deep path breaks tooling on Windows.
const work = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "symplek-consumer-smoke"));

// Environment a package needs before it will load at all. @symplek/pro refuses to
// import without a license key; a consumer who has one sets this variable, so
// the smoke test loads it the same way. The value only has the right shape.
const LOAD_ENV = {
  "@symplek/pro": { SYMPLEK_PRO_LICENSE_KEY: `symplek_pro_${"0".repeat(40)}` },
};

const shell = process.platform === "win32";
// Arguments are quoted only when a shell will parse them (Windows). With no
// shell they reach the program verbatim, and quote characters would become
// part of the path.
const arg = (value) => (shell ? JSON.stringify(value) : value);
const run = (cmd, args, cwd, options = {}) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell,
    timeout: 600_000,
    ...options,
    env: { ...process.env, ...options.env },
  }).toString();
const firstLine = (error) =>
  String(error?.stderr?.toString() || error?.message || error)
    .split("\n")
    .find((line) => line.trim()) ?? "unknown error";

rmSync(work, { recursive: true, force: true });
const tarDir = path.join(work, "tarballs");
const app = path.join(work, "app");
mkdirSync(tarDir, { recursive: true });
mkdirSync(app, { recursive: true });

const packagesDir = path.join(repo, "packages");
const packages = [];
for (const dir of readdirSync(packagesDir)) {
  const file = path.join(packagesDir, dir, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  // A private package is skipped unless it is only being held back from
  // release: one that still carries a publishConfig is meant to ship later
  // and is checked like the rest.
  if (pkg.private && !pkg.publishConfig) continue;
  run("pnpm", ["pack", "--pack-destination", arg(tarDir)], path.join(packagesDir, dir));
  packages.push(pkg);
}
const tarballs = readdirSync(tarDir).filter((f) => f.endsWith(".tgz"));
const tarballFor = (name) => {
  const hit = tarballs.find((f) => f.startsWith(`${name}-`) && /^\d/.test(f.slice(name.length + 1)));
  if (!hit) throw new Error(`no tarball was produced for ${name}`);
  return `file:${path.join(tarDir, hit).replace(/\\/g, "/")}`;
};

// Each workspace package is a dependency by tarball, and an override pins any
// transitive reference to it onto the same tarball, so nothing carrying one of
// our names is ever fetched from the registry.
const local = Object.fromEntries(packages.map((pkg) => [pkg.name, tarballFor(pkg.name)]));
writeFileSync(
  path.join(app, "package.json"),
  `${JSON.stringify({ name: "consumer-smoke", private: true, version: "0.0.0", dependencies: local, pnpm: { overrides: local } }, null, 2)}\n`,
);
writeFileSync(path.join(app, ".npmrc"), "auto-install-peers=true\nstrict-peer-dependencies=false\n");
copyFileSync(path.join(here, "consumer-smoke-probe.mjs"), path.join(app, "probe.mjs"));
try {
  run("pnpm", ["install", "--ignore-workspace"], app);
} catch (error) {
  console.error(`consumer-smoke: installing the packed packages failed\n${error.stdout ?? ""}${error.stderr ?? ""}`);
  process.exit(1);
}

const problems = [];
const lines = [];

for (const pkg of packages) {
  const dir = path.join(app, "node_modules", pkg.name);
  const installed = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const problem = (message) => problems.push(`${pkg.name}: ${message}`);
  lines.push(`${pkg.name}@${installed.version}`);

  if (JSON.stringify(installed).includes("workspace:")) {
    problem("the packed package.json still contains a `workspace:` specifier");
  }
  if (!readdirSync(dir).some((f) => /^licen[cs]e/i.test(f))) {
    problem("no LICENSE file in the tarball");
  }

  // Every file the manifest points at must be in the tarball.
  const targets = new Set();
  const collect = (value) => {
    if (typeof value === "string") {
      if (value.startsWith(".")) targets.add(value);
    } else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const field of ["exports", "bin", "main", "module", "types"]) collect(installed[field]);
  for (const target of targets) {
    if (!existsSync(path.join(dir, target))) problem(`${target} is named in package.json but missing from the tarball`);
  }

  // Load every entry point both ways, all in one process per format so that
  // duplicated copies of shared code show up.
  const entries = [];
  const exp = installed.exports;
  if (exp && typeof exp === "object" && Object.keys(exp).some((key) => key.startsWith("."))) {
    for (const [sub, target] of Object.entries(exp)) {
      if (sub.includes("*") || sub === "./package.json") continue;
      const conditions = typeof target === "string" ? { default: target } : target;
      entries.push({
        spec: sub === "." ? pkg.name : `${pkg.name}/${sub.slice(2)}`,
        esm: "import" in conditions || "default" in conditions,
        cjs: "require" in conditions,
      });
    }
  } else if (installed.main || typeof exp === "string") {
    entries.push({ spec: pkg.name, esm: true, cjs: installed.type !== "module" });
  }
  const exported = {};
  for (const mode of ["esm", "cjs"]) {
    const specs = entries.filter((entry) => entry[mode]).map((entry) => entry.spec);
    if (specs.length === 0) continue;
    let report;
    try {
      report = JSON.parse(run("node", ["probe.mjs", mode, ...specs], app, { env: LOAD_ENV[pkg.name] }));
    } catch (error) {
      problem(`${mode} probe crashed: ${firstLine(error)}`);
      continue;
    }
    for (const [spec, outcome] of Object.entries(report.entries)) {
      lines.push(`  ${mode} ${spec}: ${outcome}`);
      if (outcome.startsWith("FAIL")) problem(`${mode} load of ${spec} failed: ${outcome.slice(5)}`);
    }
    exported[mode] = report.names;
    for (const duplicate of report.duplicates) {
      problem(`${mode} entry points each carry their own copy of ${duplicate}`);
    }
  }
  // An entry point offered both ways must offer the same names both ways. A
  // re-export that one bundle format drops is otherwise invisible: both loads
  // succeed, and only one of them has the function the reader was promised.
  for (const [spec, esmNames] of Object.entries(exported.esm ?? {})) {
    const cjsNames = exported.cjs?.[spec];
    if (!cjsNames) continue;
    const list = (names) => `${names.slice(0, 6).join(", ")}${names.length > 6 ? ", ..." : ""}`;
    const onlyCjs = cjsNames.filter((name) => !esmNames.includes(name));
    const onlyEsm = esmNames.filter((name) => !cjsNames.includes(name));
    if (onlyCjs.length) problem(`${spec}: ${onlyCjs.length} export(s) reachable by require but not by import: ${list(onlyCjs)}`);
    if (onlyEsm.length) problem(`${spec}: ${onlyEsm.length} export(s) reachable by import but not by require: ${list(onlyEsm)}`);
  }

  // A package that is meant to refuse to load without its environment must
  // actually refuse: otherwise the gate could be removed and nothing would say.
  if (LOAD_ENV[pkg.name]) {
    const cleared = Object.fromEntries(Object.keys(LOAD_ENV[pkg.name]).map((key) => [key, ""]));
    const mode = entries.some((entry) => entry.esm) ? "esm" : "cjs";
    try {
      const report = JSON.parse(run("node", ["probe.mjs", mode, pkg.name], app, { env: cleared }));
      if (report.entries[pkg.name]?.startsWith("FAIL")) {
        lines.push(`  refuses to load without ${Object.keys(cleared).join(", ")}: OK`);
      } else {
        problem(`loads without ${Object.keys(cleared).join(", ")} set, so its load gate is not enforced`);
      }
    } catch (error) {
      problem(`load-gate probe crashed: ${firstLine(error)}`);
    }
  }

  // A bin has to parse, and has to answer --help and exit rather than hang.
  const bins = typeof installed.bin === "string" ? { [pkg.name]: installed.bin } : (installed.bin ?? {});
  for (const [name, target] of Object.entries(bins)) {
    const file = path.join(dir, target);
    if (!existsSync(file)) continue; // already reported above
    try {
      run("node", ["--check", arg(file)], app);
      run("node", [arg(file), "--help"], app, { timeout: 30_000, env: LOAD_ENV[pkg.name] });
      lines.push(`  bin ${name}: OK`);
    } catch (error) {
      lines.push(`  bin ${name}: FAIL`);
      problem(`bin ${name} (${target}) does not start: ${firstLine(error)}`);
    }
  }
}

console.log(lines.join("\n"));
if (problems.length) {
  console.error(`\nconsumer-smoke: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nconsumer-smoke: OK (${packages.length} packages installed from tarballs)`);
