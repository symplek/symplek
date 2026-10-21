#!/usr/bin/env node
/**
 * Scaffold end-to-end test. Follows a new user's first ten minutes with the
 * CLI and fails if any step the CLI leads them to does not work.
 *
 * For each project template tier it:
 *   1. scaffolds a project with the built CLI's own scaffolder
 *   2. installs it, with the workspace packages taken from local tarballs
 *      (nothing carrying one of our names is fetched from the registry)
 *   3. runs the project's own `typecheck`, and `test` where the tier has one
 *   4. runs `weft validate` and `weft generate` on the scaffolded agent
 *   5. runs `weft add agent` for every agent type, then validates, generates,
 *      type-checks and tests again
 *
 * Run after `pnpm build`:  node scripts/scaffold-e2e.mjs [work-dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "weft-scaffold-e2e"));
const shell = process.platform === "win32";
// Quote only when a shell will parse the argument (see consumer-smoke.mjs).
const arg = (value) => (shell ? JSON.stringify(value) : value);

function run(cmd, args, cwd, timeout = 600_000) {
  return execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell, timeout }).toString();
}

rmSync(work, { recursive: true, force: true });
const tarDir = path.join(work, "tarballs");
mkdirSync(tarDir, { recursive: true });

// The scaffolded project needs the library and the CLI that created it.
const local = {};
for (const dir of ["weft-core", "weft-cli"]) {
  const pkgDir = path.join(repo, "packages", dir);
  const { name } = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  run("pnpm", ["pack", "--pack-destination", arg(tarDir)], pkgDir);
  const tarball = readdirSync(tarDir).find((f) => f.startsWith(`${name}-`) && f.endsWith(".tgz"));
  local[name] = `file:${path.join(tarDir, tarball).replace(/\\/g, "/")}`;
}

const cliDir = path.join(repo, "packages", "weft-cli");
const cli = createRequire(path.join(cliDir, "package.json"))(".");
const AGENT_TYPES = ["general", "researcher", "reviewer", "custom", "typescript"];
const failures = [];

for (const tier of ["minimal", "standard", "full"]) {
  const name = `e2e-${tier}`;
  const project = path.join(work, name);
  const step = (label, fn) => {
    try {
      fn();
      console.log(`  ok    ${label}`);
      return true;
    } catch (error) {
      const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error.message);
      console.log(`  FAIL  ${label}`);
      failures.push(`${tier}: ${label}\n${detail.split("\n").slice(-25).join("\n")}`);
      return false;
    }
  };
  console.log(`${tier}`);

  await cli.createProject({ name, template: tier, packageManager: "pnpm", typescript: "strict", targetDir: project });

  // Point the two workspace packages at their tarballs, as a published
  // install would resolve them, and install everything else from the registry.
  const manifestPath = path.join(project, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.pnpm = { overrides: local };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const scripts = manifest.scripts ?? {};
  const weft = ["exec", "weft"];

  if (!step("install", () => run("pnpm", ["install", "--ignore-workspace"], project))) continue;
  step("typecheck", () => run("pnpm", ["run", "typecheck"], project));
  if (scripts.test) step("test", () => run("pnpm", ["run", "test"], project));
  step("weft validate", () => run("pnpm", [...weft, "validate"], project));
  step("weft generate", () => run("pnpm", [...weft, "generate"], project));

  for (const type of AGENT_TYPES) {
    const agent = `helper-${type}`;
    step(`weft add agent --type ${type}`, () => {
      run("pnpm", [...weft, "add", "agent", agent, "--type", type, "--model", "gpt-4o"], project);
      if (!existsSync(path.join(project, "agents")) || !readdirSync(path.join(project, "agents")).some((f) => f.startsWith(agent))) {
        throw new Error(`no file for ${agent} was written under agents/`);
      }
    });
  }
  step("weft validate (after add)", () => run("pnpm", [...weft, "validate"], project));
  step("weft generate (after add)", () => run("pnpm", [...weft, "generate"], project));
  // The CLI tells the user to import the agent it wrote. Do that from the
  // project's own entry point, so the project's compiler settings have to
  // accept a file under agents/.
  step("an added agent is imported from src/index.ts", () => {
    const entry = path.join(project, "src", "index.ts");
    writeFileSync(
      entry,
      `import { helperGeneral } from "../agents/helper-general.js";\nvoid helperGeneral;\n${readFileSync(entry, "utf8")}`,
    );
  });
  step("typecheck (after add and generate)", () => run("pnpm", ["run", "typecheck"], project));
  step("build", () => run("pnpm", ["run", "build"], project));
  step(".gitignore keeps node_modules out of the repository", () => {
    const ignore = path.join(project, ".gitignore");
    if (!existsSync(ignore) || !readFileSync(ignore, "utf8").includes("node_modules")) {
      throw new Error("no .gitignore listing node_modules was scaffolded");
    }
  });
  if (scripts.test) step("test (after add and generate)", () => run("pnpm", ["run", "test"], project));
}

if (failures.length) {
  console.error(`\nscaffold-e2e: ${failures.length} step(s) failed\n`);
  for (const failure of failures) console.error(`--- ${failure}\n`);
  process.exit(1);
}
console.log("\nscaffold-e2e: OK");
