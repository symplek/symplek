#!/usr/bin/env node
// Packs every publishable workspace package the way `changeset publish` does
// (`pnpm pack`) and inspects the tarball. Fails if a packed package:
//   - still carries a `workspace:` specifier in its package.json,
//   - names a main / module / types / exports / bin target that is not in the tarball,
//   - has a bin target that Node cannot parse,
//   - ships without a LICENSE file.
// Run it after a build, from the repository root: node .github/scripts/check-packed-packages.mjs
// It publishes nothing and writes only to a temporary directory.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Read a .tgz into a Map of path -> Buffer. Handles pax and GNU long names. */
function readTarball(file) {
  const buf = gunzipSync(readFileSync(file));
  const files = new Map();
  let offset = 0;
  let longName = null;
  const text = (start, length) =>
    buf
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "");
  while (offset + 512 <= buf.length) {
    const name = text(offset, 100);
    if (name === "") break;
    const size = Number.parseInt(text(offset + 124, 12).trim() || "0", 8);
    const type = text(offset + 156, 1);
    const prefix = text(offset + 345, 155);
    const body = buf.subarray(offset + 512, offset + 512 + size);
    if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (match) longName = match[1];
    } else if (type === "L") {
      longName = body.toString("utf8").replace(/\0.*$/s, "");
    } else {
      const path = longName ?? (prefix ? `${prefix}/${name}` : name);
      longName = null;
      if (type === "0" || type === "") files.set(path, body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every file path a manifest promises: main, module, types, bin and export leaves. */
function entryTargets(pkg) {
  const targets = [];
  const add = (label, value) => {
    if (typeof value === "string") targets.push({ label, value });
  };
  add("main", pkg.main);
  add("module", pkg.module);
  add("types", pkg.types);
  if (typeof pkg.bin === "string") add("bin", pkg.bin);
  else
    for (const [name, value] of Object.entries(pkg.bin ?? {}))
      add(`bin.${name}`, value);
  const visit = (label, value) => {
    if (typeof value === "string") add(label, value);
    else if (value && typeof value === "object")
      for (const [key, inner] of Object.entries(value))
        visit(`${label}[${key}]`, inner);
  };
  visit("exports", pkg.exports);
  return targets;
}

const root = process.cwd();
const packagesDir = join(root, "packages");
const work = mkdtempSync(join(tmpdir(), "symplek-pack-"));
const problems = [];
let checked = 0;

try {
  for (const dir of readdirSync(packagesDir).sort()) {
    const pkgDir = join(packagesDir, dir);
    const manifestPath = join(pkgDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const source = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (source.private) {
      console.log(`skip ${source.name} (private)`);
      continue;
    }

    const dest = join(work, dir);
    mkdirSync(dest, { recursive: true });
    const pack = spawnSync("pnpm", ["pack", "--pack-destination", dest], {
      cwd: pkgDir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (pack.status !== 0) {
      problems.push(`${source.name}: pnpm pack failed\n${pack.stderr}`);
      continue;
    }
    const tarball = readdirSync(dest).find((f) => f.endsWith(".tgz"));
    const files = readTarball(join(dest, tarball));
    const rawManifest = files.get("package/package.json")?.toString("utf8");
    if (!rawManifest) {
      problems.push(`${source.name}: no package.json in ${tarball}`);
      continue;
    }
    const packed = JSON.parse(rawManifest);
    checked++;
    const before = problems.length;

    if (rawManifest.includes("workspace:"))
      problems.push(
        `${packed.name}: packed package.json still contains a "workspace:" specifier`,
      );

    for (const { label, value } of entryTargets(packed)) {
      const rel = value.replace(/^\.\//, "");
      if (!files.has(`package/${rel}`))
        problems.push(
          `${packed.name}: ${label} points at ${value}, which is not in the tarball`,
        );
    }

    const bins =
      typeof packed.bin === "string"
        ? [packed.bin]
        : Object.values(packed.bin ?? {});
    for (const bin of bins) {
      const binPath = join(pkgDir, bin);
      if (!existsSync(binPath)) continue; // already reported as a missing target
      const parse = spawnSync(process.execPath, ["--check", binPath], {
        encoding: "utf8",
      });
      if (parse.status !== 0)
        problems.push(
          `${packed.name}: bin ${bin} does not parse, so the command cannot start\n${parse.stderr.trim().split("\n").slice(0, 4).join("\n")}`,
        );
    }

    if (!files.has("package/LICENSE"))
      problems.push(`${packed.name}: no LICENSE file in the tarball`);

    console.log(
      `${problems.length === before ? "ok  " : "FAIL"} ${packed.name}@${packed.version} (${files.size} files)`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) in packed packages:`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`\nOK: ${checked} packed package(s) inspected, no problems`);
