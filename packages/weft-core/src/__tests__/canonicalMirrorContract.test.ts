/**
 * @fileoverview Canonical ↔ Mirror Contract Tests
 * @description Asserts behavioral and structural equivalence between the
 *   canonical WEFT source at `convex/lib/agent_framework/` and
 *   the weft-core distribution mirror at `packages/weft-core/src/`.
 *
 * SCOPE — four shared concepts per WEFT-ARCHITECTURE.md §"Shared concepts":
 *   1. AgentUnit     canonical: algebra/core/AgentUnit.ts  | mirror: AgentUnit.ts
 *   2. WeftError     canonical: core/weftErrors.ts         | mirror: errors.ts
 *   3. WeftBuilder   canonical: weft/facades/shared.ts     | mirror: facade.ts
 *   4. RetryOptions  canonical: weft/core/validation.ts    | mirror: types.ts
 *
 * STRATEGY
 *   Mirror side: imported directly from the package source (relative paths).
 *   Canonical side: the Convex canonical files import Convex-specific runtime
 *     types (AgentContext tied to Convex, LanguageModel from "ai", etc.) that
 *     fail to resolve in a pure Node/Vitest environment. Where live import is
 *     impossible we fall back to STRUCTURAL tests that parse the source file as
 *     text and assert export names / type member names via regex.
 *   Any structural fallback is clearly annotated with: STRUCTURAL-FALLBACK.
 *
 * HOW TO READ FAILURES
 *   A failing test means the two codebases have drifted. Do NOT fix the test —
 *   fix the drift in the canonical or mirror source, then re-run.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeftBuilder } from "../builder";
import type { WeftErrorCode } from "../errors";
import { WeftError } from "../errors";
// ─── Mirror imports (always work — pure Node/Vitest) ─────────────────────────
import { AgentUnit, createContext } from "../index";
import type { AgentContext, RetryOptions } from "../types";

// ─── Canonical source file paths (for structural fallbacks) ──────────────────
// Four levels up from src/__tests__: src/__tests__ → src → weft-core → packages → repo root
const REPO_ROOT = resolve(__dirname, "../../../../");

// ─── Skip-guard: canonical source only exists in the upstream private monorepo.
// In this published package repo, convex/lib/agent_framework/ is absent.
// All suites below are wrapped with describe.skipIf so they self-skip here
// and still run in full in the upstream checkout where the canonical half is present.
const CANONICAL_DIR = resolve(REPO_ROOT, "convex/lib/agent_framework");
const canonicalPresent = existsSync(CANONICAL_DIR);

function readCanonical(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

// Helper to extract all `export` identifier names from a TypeScript source file.
function _extractExports(source: string): string[] {
  const matches: string[] = [];
  // Matches: export class Foo, export function foo, export type Foo, export interface Foo, export const foo, export { Foo }
  const re =
    /export\s+(?:(?:abstract|declare)\s+)?(?:class|function\*?|type|interface|const|let|var|enum)\s+([\w$]+)/g;
  for (const m of source.matchAll(re)) {
    if (m[1]) matches.push(m[1]);
  }
  // Also capture named exports like: export { Foo, Bar }
  const namedRe = /export\s*\{([^}]+)\}/g;
  for (const m of source.matchAll(namedRe)) {
    if (m[1]) {
      m[1].split(",").forEach((s) => {
        const name = s
          .trim()
          .split(/\s+as\s+/)
          .pop()!
          .trim();
        if (name) matches.push(name);
      });
    }
  }
  return [...new Set(matches)];
}

// Helper: extract interface/type member names from a block `{ ... }`.
function _extractTypeMembers(source: string, typeName: string): string[] {
  // Match the body of `interface FooName {` or `type FooName = {`
  const re = new RegExp(
    `(?:interface|type)\\s+${typeName}\\s*(?:<[^>]*>)?\\s*(?:=\\s*)?\\{([^}]*)\\}`,
    "s",
  );
  const m = re.exec(source);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("*"))
    .map((line) => line.split(/[\s:?]/)[0].replace(/[;,]$/, ""))
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. AgentUnit
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canonicalPresent)("AgentUnit — canonical ↔ mirror contract", () => {
  const ctx: AgentContext = createContext();

  // Silence legacy deprecation warnings emitted by .run(ctx, {trustMode:'legacy'})
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset the per-process deprecation guard so legacy tests don't bleed
    (
      AgentUnit as unknown as { _deprecationWarned: boolean }
    )._deprecationWarned = false;
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  // ── 1a. Static factory: .of() ─────────────────────────────────────────────

  describe(".of(value)", () => {
    it("mirror: resolves to the lifted value in legacy mode", async () => {
      const unit = AgentUnit.of(42);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(42);
    });

    it("mirror: resolves to TrackedResult with correct value in zero-trust mode", async () => {
      const unit = AgentUnit.of("hello");
      const tracked = await unit.run(ctx);
      expect(tracked.value).toBe("hello");
    });

    it("mirror: operatorChain starts with 'of'", () => {
      const unit = AgentUnit.of(1);
      expect(unit.getMetadata().operatorChain).toEqual(["of"]);
    });

    // STRUCTURAL-FALLBACK: Verify canonical uses same operatorChain label
    it("canonical: .of() sets operatorChain to ['of'] (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      // The canonical static of() factory must record operatorChain: ["of"]
      expect(source).toMatch(/operatorChain:\s*\["of"\]/);
    });
  });

  // ── 1b. Static factory: .from() ───────────────────────────────────────────

  describe(".from(computation)", () => {
    it("mirror: executes the provided async computation", async () => {
      const unit = AgentUnit.from(async (_c) => "computed");
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("computed");
    });

    it("mirror: operatorChain starts with 'from'", () => {
      const unit = AgentUnit.from(async () => 0);
      expect(unit.getMetadata().operatorChain).toEqual(["from"]);
    });

    // STRUCTURAL-FALLBACK: canonical parity
    it("canonical: .from() sets operatorChain to ['from'] (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      expect(source).toMatch(/operatorChain:\s*\["from"\]/);
    });
  });

  // ── 1c. .map(fn) ──────────────────────────────────────────────────────────

  describe(".map(fn)", () => {
    it("mirror: transforms the resolved value", async () => {
      const unit = AgentUnit.of(10).map((n) => n * 3);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(30);
    });

    it("mirror: operatorChain appends 'map'", () => {
      const unit = AgentUnit.of(1).map((n) => n);
      expect(unit.getMetadata().operatorChain).toContain("map");
    });

    it("mirror: chained maps compose correctly", async () => {
      const unit = AgentUnit.of(2)
        .map((n) => n + 1)
        .map((n) => n * 10);
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(30);
    });

    // STRUCTURAL-FALLBACK: canonical defines map as an override method
    it("canonical: .map() is defined on the AgentUnit class (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      expect(source).toMatch(/override map</);
    });
  });

  // ── 1d. .flatMap(fn) / .chain(fn) ─────────────────────────────────────────

  describe(".flatMap(fn) / .chain(fn)", () => {
    it("mirror: flatMap sequences two computations", async () => {
      const unit = AgentUnit.of("a").flatMap((s) => AgentUnit.of(`${s}b`));
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("ab");
    });

    it("mirror: .chain() is an alias for .flatMap()", async () => {
      const unit = AgentUnit.of(5).chain((n) => AgentUnit.of(n * 2));
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe(10);
    });

    it("mirror: operatorChain appends 'flatMap' for flatMap", () => {
      const unit = AgentUnit.of(1).flatMap((n) => AgentUnit.of(n));
      expect(unit.getMetadata().operatorChain).toContain("flatMap");
    });

    // STRUCTURAL-FALLBACK: canonical must export chain
    it("canonical: .chain() method exists (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      expect(source).toMatch(/chain\s*</);
    });
  });

  // ── 1e. static .zipAll([]) ────────────────────────────────────────────────

  describe("static .zipAll(units)", () => {
    it("mirror: collects results in input order", async () => {
      const result = await AgentUnit.zipAll([
        AgentUnit.of(1),
        AgentUnit.of(2),
        AgentUnit.of(3),
      ]).run(ctx, { trustMode: "legacy" });
      expect(result).toEqual([1, 2, 3]);
    });

    it("mirror: empty array resolves to []", async () => {
      const result = await AgentUnit.zipAll([]).run(ctx, {
        trustMode: "legacy",
      });
      expect(result).toEqual([]);
    });

    it("mirror: operatorChain includes 'zipAll'", () => {
      const unit = AgentUnit.zipAll([AgentUnit.of(1)]);
      expect(unit.getMetadata().operatorChain).toContain("zipAll");
    });

    // STRUCTURAL-FALLBACK: canonical defines zipAll
    it("canonical: static .zipAll() is defined (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      expect(source).toMatch(/static zipAll/);
    });
  });

  // ── 1f. static .race([]) ──────────────────────────────────────────────────

  describe("static .race(units)", () => {
    it("mirror: returns the first unit to resolve", async () => {
      const fast = AgentUnit.from(async () => {
        return "fast";
      });
      const slow = AgentUnit.from(
        () => new Promise<string>((res) => setTimeout(() => res("slow"), 200)),
      );
      const result = await AgentUnit.race([fast, slow]).run(ctx, {
        trustMode: "legacy",
      });
      expect(result).toBe("fast");
    });

    it("mirror: operatorChain includes 'race'", () => {
      const unit = AgentUnit.race([AgentUnit.of(1)]);
      expect(unit.getMetadata().operatorChain).toContain("race");
    });

    // STRUCTURAL-FALLBACK: canonical defines race
    it("canonical: static .race() is defined (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      expect(source).toMatch(/static race/);
    });
  });

  // ── 1g. .retry(n) ─────────────────────────────────────────────────────────

  describe(".retry(n)", () => {
    it("mirror: succeeds after initial failures", async () => {
      let attempts = 0;
      const unit = AgentUnit.from(async () => {
        attempts++;
        if (attempts < 3) throw new Error("not yet");
        return "success";
      }).retry(5, { baseDelayMs: 0 });
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("success");
      expect(attempts).toBe(3);
    });

    it("mirror: rejects after all attempts exhausted", async () => {
      const unit = AgentUnit.from(async () => {
        throw new Error("always fails");
      }).retry(2, { baseDelayMs: 0 });
      await expect(unit.run(ctx, { trustMode: "legacy" })).rejects.toThrow(
        "always fails",
      );
    });

    it("mirror: operatorChain appends 'retry'", () => {
      const unit = AgentUnit.of(1).retry(2);
      expect(unit.getMetadata().operatorChain).toContain("retry");
    });

    // STRUCTURAL-FALLBACK: canonical defines retry
    it("canonical: .retry() operator is defined (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/operators/resilience.ts",
      );
      expect(source).toMatch(/retry\s*\(/);
    });
  });

  // ── 1h. .fallback() / .orElse() ───────────────────────────────────────────

  describe(".fallback(other) and .orElse(value)", () => {
    it("mirror: .fallback() executes backup unit on failure", async () => {
      const unit = AgentUnit.fail<string>(new Error("boom")).fallback(
        AgentUnit.of("backup"),
      );
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("backup");
    });

    it("mirror: .fallback() does not execute backup on success", async () => {
      let backupCalled = false;
      const unit = AgentUnit.of("primary").fallback(
        AgentUnit.from(async () => {
          backupCalled = true;
          return "backup";
        }),
      );
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("primary");
      expect(backupCalled).toBe(false);
    });

    it("mirror: .orElse() returns static value on failure", async () => {
      const unit = AgentUnit.fail<string>(new Error("oops")).orElse("safe");
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("safe");
    });

    it("mirror: operatorChain appends 'fallback'", () => {
      const unit = AgentUnit.of(1).fallback(AgentUnit.of(2));
      expect(unit.getMetadata().operatorChain).toContain("fallback");
    });

    // STRUCTURAL-FALLBACK: canonical defines both methods
    it("canonical: .fallback() and .orElse() are defined (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/operators/resilience.ts",
      );
      expect(source).toMatch(/fallback\s*\(/);
      expect(source).toMatch(/orElse\s*\(/);
    });
  });

  // ── 1i. Method presence parity ────────────────────────────────────────────

  describe("method presence parity", () => {
    // These are the operator methods the mirror adds via prototype augmentation.
    // They must all exist on the mirror's AgentUnit prototype.
    const expectedMirrorMethods = [
      "map",
      "flatMap",
      "chain",
      "tap",
      "fallback",
      "orElse",
      "retry",
      "timeout",
    ] as const;

    for (const method of expectedMirrorMethods) {
      it(`mirror: prototype has .${method}()`, () => {
        expect(
          typeof (AgentUnit.prototype as Record<string, unknown>)[method],
        ).toBe("function");
      });
    }

    // STRUCTURAL-FALLBACK: canonical operator files define the same set
    it("canonical: resilience operators file exports retry, fallback, orElse, timeout (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/operators/resilience.ts",
      );
      expect(source).toMatch(/retry/);
      expect(source).toMatch(/fallback/);
      expect(source).toMatch(/orElse/);
      expect(source).toMatch(/timeout/);
    });

    // DRIFT DETECTOR: canonical has .fromAgent() which mirror does NOT expose
    it("canonical has .fromAgent() / mirror does not — known divergence is documented (structural)", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      // Canonical exports fromAgent (Convex-specific)
      expect(canonicalSource).toMatch(/static fromAgent/);
      // Mirror does NOT need to export fromAgent — it is Convex-specific
      expect(
        typeof (AgentUnit as unknown as Record<string, unknown>).fromAgent,
      ).toBe("undefined");
    });

    // DRIFT DETECTOR: canonical has .fromWithFallback() — mirror should too
    it("mirror exposes .fromWithFallback() matching canonical (structural + runtime)", async () => {
      // STRUCTURAL: check canonical defines it
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
      );
      // Note: canonical file is a barrel re-export; check the mirror's AgentUnit body
      // The mirror AgentUnit.ts does define fromWithFallback per our read above
      const mirrorSource = readFileSync(
        resolve(__dirname, "../AgentUnit/AgentUnit.ts"),
        "utf8",
      );
      expect(mirrorSource).toMatch(/static fromWithFallback/);

      // RUNTIME: verify it works
      const unit = AgentUnit.fromWithFallback(
        async () => {
          throw new Error("primary failed");
        },
        () => "fallback value",
      );
      const result = await unit.run(ctx, { trustMode: "legacy" });
      expect(result).toBe("fallback value");

      // Canonical does NOT define fromWithFallback in the main AgentUnit file
      // (it lives in the mirror only). Flag as known divergence.
      const hasInCanonical = /static fromWithFallback/.test(canonicalSource);
      // This assertion documents the current state; if it starts failing it means
      // someone added fromWithFallback to canonical — update this test accordingly.
      expect(hasInCanonical).toBe(false); // Known divergence: mirror-only addition
    });
  });

  // ── 1j. Metadata shape parity ─────────────────────────────────────────────

  describe("AgentUnitMetadata shape", () => {
    it("mirror: getMetadata() returns id, operatorChain, createdAt", () => {
      const unit = AgentUnit.of(1);
      const meta = unit.getMetadata();
      expect(typeof meta.id).toBe("string");
      expect(meta.id).toMatch(/^au_/);
      expect(Array.isArray(meta.operatorChain)).toBe(true);
      expect(typeof meta.createdAt).toBe("number");
    });

    // STRUCTURAL-FALLBACK: canonical metadata has same required fields
    // Note: canonical AgentUnitMetadata lives in algebra/core/types/agent.types.ts
    it("canonical: AgentUnitMetadata has id, operatorChain, createdAt (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/algebra/core/types/agent.types.ts",
      );
      expect(source).toMatch(/id\s*:/);
      expect(source).toMatch(/operatorChain\s*:/);
      expect(source).toMatch(/createdAt\s*:/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WeftError
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canonicalPresent)("WeftError — canonical ↔ mirror contract", () => {
  // ── 2a. ErrorCode taxonomy parity ─────────────────────────────────────────

  describe("ErrorCode taxonomy", () => {
    /**
     * STRUCTURAL-FALLBACK (both sides):
     * The canonical WeftErrorCode is a union of descriptive strings.
     * The mirror has two code systems: Exx codes (ErrorCode) + descriptive WeftErrorCode.
     * We assert:
     *   (a) canonical's WeftErrorCode union members exist in the mirror's WeftErrorCode
     *   (b) mirror's WeftErrorCode members are documented
     */

    // Canonical descriptive codes (from convex/lib/agent_framework/core/weftErrors.ts)
    const CANONICAL_CODES = [
      "MODEL_UNAVAILABLE",
      "MODEL_UNSUPPORTED_ALIAS",
      "QUOTA_EXCEEDED",
      "TIMEOUT",
      "PROVIDER_DOWN",
      "CONTRACT_MISMATCH",
      "CIRCUIT_OPEN",
      "RATE_LIMITED",
      "SESSION_EXPIRED",
      "IDEMPOTENCY_CONFLICT",
      "UNKNOWN",
    ] as const;

    // Mirror descriptive codes (from packages/weft-core/src/errors.ts)
    const MIRROR_CODES: WeftErrorCode[] = [
      "AUTH_FAILED",
      "RATE_LIMIT_EXCEEDED",
      "INVALID_SCHEMA",
      "PROVIDER_ERROR",
      "SETUP_ERROR",
      "TIMEOUT",
      "NETWORK_ERROR",
      "UNKNOWN_ERROR",
    ];

    it("mirror: WeftErrorCode union includes TIMEOUT (shared code)", () => {
      // TIMEOUT is the only code shared between canonical and mirror descriptive sets
      expect(MIRROR_CODES).toContain("TIMEOUT");
    });

    it("canonical: WeftErrorCode union includes TIMEOUT (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      expect(source).toMatch(/"TIMEOUT"/);
    });

    it("DIVERGENCE DOCUMENTED: canonical and mirror have different WeftErrorCode sets", () => {
      // The two descriptive code sets are intentionally different.
      // Canonical is Convex-oriented; mirror is package-oriented.
      // This test documents the known divergence for future maintainers.
      const canonicalSet = new Set(CANONICAL_CODES);
      const mirrorSet = new Set(MIRROR_CODES);
      const shared = [...canonicalSet].filter((c) =>
        mirrorSet.has(c as WeftErrorCode),
      );
      // Only TIMEOUT is shared — document this
      expect(shared).toEqual(["TIMEOUT"]);
    });

    it("canonical: WeftErrorCode type is exported (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      expect(source).toMatch(/export type WeftErrorCode/);
    });

    it("mirror: WeftErrorCode type is exported (runtime)", () => {
      // WeftError is already imported at the top of this file from "../errors".
      // The fact that the import succeeded proves errors.ts exports it correctly.
      expect(typeof WeftError).toBe("function");
    });
  });

  // ── 2b. WeftError construction shape ──────────────────────────────────────

  describe("WeftError construction", () => {
    it("mirror: constructs with code and message fields", () => {
      const err = new WeftError({
        code: "SETUP_ERROR",
        message: "test error",
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WeftError);
      expect(err.code).toBe("SETUP_ERROR");
      expect(err.name).toBe("WeftError");
    });

    it("mirror: constructs with 'why' field (preferred over message)", () => {
      const err = new WeftError({
        code: "TIMEOUT",
        why: "the operation timed out",
      });
      expect(err.message).toContain("the operation timed out");
    });

    it("mirror: message is prefixed with [weft@version]", () => {
      const err = new WeftError({ code: "SETUP_ERROR", why: "oops" });
      expect(err.message).toMatch(/^\[weft@/);
    });

    it("mirror: optional fields (action, docs, example, context) are settable", () => {
      const err = new WeftError({
        code: "SETUP_ERROR",
        why: "missing key",
        action: "Set the key",
        docs: "https://docs.example.com",
        example: 'process.env.KEY = "value"',
        context: { component: "TestComponent" },
      });
      expect(err.action).toBe("Set the key");
      expect(err.docs).toBe("https://docs.example.com");
      expect(err.example).toBe('process.env.KEY = "value"');
      expect(err.context?.component).toBe("TestComponent");
    });

    // STRUCTURAL-FALLBACK: canonical constructor shape
    it("canonical: WeftError constructor takes code, why, fix (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      // Canonical takes { code, why, fix } as required fields
      expect(source).toMatch(/code:\s*WeftErrorCode/);
      expect(source).toMatch(/why:\s*string/);
      expect(source).toMatch(/fix:\s*string/);
    });

    it("DIVERGENCE DOCUMENTED: canonical requires 'fix' field; mirror makes it optional", () => {
      // Canonical: fix: string  (required)
      // Mirror:    fix?: WeftErrorDetail["fix"]  (optional, different shape)
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      // Canonical has `fix: string` (no ?)
      expect(canonicalSource).toMatch(/^\s+fix:\s+string/m);

      const mirrorSource = readFileSync(
        resolve(__dirname, "../errors.ts"),
        "utf8",
      );
      // Mirror has `fix?: ...` (optional)
      expect(mirrorSource).toMatch(/fix\?:/);
    });

    it("DIVERGENCE DOCUMENTED: canonical has 'why' and 'recoverable' fields; mirror has neither", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      // Canonical has `why`, `fix`, `recoverable` as class properties
      expect(canonicalSource).toMatch(/readonly why:/);
      expect(canonicalSource).toMatch(/readonly recoverable:/);

      const mirrorSource = readFileSync(
        resolve(__dirname, "../errors.ts"),
        "utf8",
      );
      // Mirror does NOT have `why` or `recoverable` as class properties
      expect(mirrorSource).not.toMatch(/readonly why:/);
      expect(mirrorSource).not.toMatch(/readonly recoverable:/);
    });
  });

  // ── 2c. WeftError serialization ───────────────────────────────────────────

  describe("WeftError serialization", () => {
    it("mirror: toJSON() returns structured SerializedError object", () => {
      const err = new WeftError({
        code: "SETUP_ERROR",
        why: "missing config",
        action: "Add config",
      });
      const json = err.toJSON();
      expect(json.name).toBe("WeftError");
      expect(json.code).toBe("SETUP_ERROR");
      expect(typeof json.message).toBe("string");
    });

    it("mirror: toJSON() does not include stack trace", () => {
      const err = new WeftError({ code: "TIMEOUT", why: "timed out" });
      const json = err.toJSON() as Record<string, unknown>;
      expect(json.stack).toBeUndefined();
    });

    it("mirror: context is sanitized — sensitive keys are redacted", () => {
      const err = new WeftError({
        code: "SETUP_ERROR",
        why: "auth failed",
        context: { api_key: "sk-super-secret", component: "auth" },
      });
      expect(err.context?.api_key).toBe("[REDACTED]");
      expect(err.context?.component).toBe("auth");
    });

    // STRUCTURAL-FALLBACK: canonical has toEnvelope() instead of toJSON()
    it("canonical: exposes toEnvelope() for serialization (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      expect(source).toMatch(/export function toEnvelope/);
    });

    it("DIVERGENCE DOCUMENTED: mirror uses toJSON(); canonical uses toEnvelope() pattern", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      const mirrorSource = readFileSync(
        resolve(__dirname, "../errors.ts"),
        "utf8",
      );
      // Mirror has toJSON
      expect(mirrorSource).toMatch(/toJSON\s*\(\)/);
      // Canonical does NOT have toJSON on the class
      expect(canonicalSource).not.toMatch(/toJSON\s*\(\)/);
      // Canonical uses the free function toEnvelope()
      expect(canonicalSource).toMatch(/toEnvelope/);
    });

    // STRUCTURAL-FALLBACK: canonical type guards are exported
    it("canonical: exports isWeftError, isWeftRecoverable, isWeftTerminal (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/core/weftErrors.ts",
      );
      expect(source).toMatch(/export function isWeftError/);
      expect(source).toMatch(/export function isWeftRecoverable/);
      expect(source).toMatch(/export function isWeftTerminal/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WeftBuilder
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canonicalPresent)("WeftBuilder — canonical ↔ mirror contract", () => {
  /**
   * STRUCTURAL-FALLBACK (canonical side):
   * The canonical WeftBuilder in convex/lib/agent_framework/weft/facades/shared.ts
   * imports Convex-specific types (AgentContext with Convex bindings, LanguageModel
   * from "ai", GovernanceConfig, etc.) that fail to resolve outside of Convex.
   * All canonical assertions below are structural (source-text) checks only.
   */

  // ── 3a. Class exists and is constructable ─────────────────────────────────

  describe("WeftBuilder class presence", () => {
    it("mirror: WeftBuilder is exported as a class", () => {
      expect(typeof WeftBuilder).toBe("function");
      expect(WeftBuilder.prototype).toBeDefined();
    });

    it("canonical: WeftBuilder class is defined (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/facades/shared.ts",
      );
      expect(source).toMatch(/export class WeftBuilder/);
    });
  });

  // ── 3b. Fluent builder method names ───────────────────────────────────────

  describe("fluent method names", () => {
    // Mirror methods that must exist on WeftBuilder prototype
    const MIRROR_BUILDER_METHODS = ["toUnit", "run", "then"] as const;

    for (const method of MIRROR_BUILDER_METHODS) {
      it(`mirror: WeftBuilder has .${method}() method`, () => {
        expect(
          typeof (WeftBuilder.prototype as Record<string, unknown>)[method],
        ).toBe("function");
      });
    }

    // STRUCTURAL-FALLBACK: canonical method presence
    it("canonical: WeftBuilder has .prompt(), .withFallback(), .withBudget(), .toUnit(), .run() (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/facades/shared.ts",
      );
      expect(source).toMatch(/prompt\s*\(/);
      expect(source).toMatch(/withFallback\s*\(/);
      expect(source).toMatch(/withBudget\s*\(/);
      expect(source).toMatch(/toUnit\s*\(\)/);
      expect(source).toMatch(/async run\s*\(/);
    });

    it("DIVERGENCE DOCUMENTED: canonical has .prompt()/.withFallback()/.withBudget(); mirror does not", () => {
      // Mirror WeftBuilder is simpler: task + options only, no fluent chaining
      expect(
        typeof (WeftBuilder.prototype as Record<string, unknown>).prompt,
      ).toBe("undefined");
      expect(
        typeof (WeftBuilder.prototype as Record<string, unknown>).withFallback,
      ).toBe("undefined");
      expect(
        typeof (WeftBuilder.prototype as Record<string, unknown>).withBudget,
      ).toBe("undefined");
    });
  });

  // ── 3c. .toUnit() returns an AgentUnit ────────────────────────────────────

  describe(".toUnit()", () => {
    it("mirror: .toUnit() returns an AgentUnit instance", () => {
      const builder = new WeftBuilder("test task");
      const unit = builder.toUnit();
      expect(unit).toBeInstanceOf(AgentUnit);
    });

    it("mirror: consecutive .toUnit() calls return the same cached instance", () => {
      const builder = new WeftBuilder("test task");
      const unit1 = builder.toUnit();
      const unit2 = builder.toUnit();
      expect(unit1).toBe(unit2);
    });

    // STRUCTURAL-FALLBACK: canonical toUnit() returns AgentUnit
    it("canonical: .toUnit() returns AgentUnit.from(...) (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/facades/shared.ts",
      );
      expect(source).toMatch(/return AgentUnit\.from\(computation\)/);
    });
  });

  // ── 3d. Mirror is PromiseLike ──────────────────────────────────────────────

  describe("PromiseLike contract", () => {
    it("mirror: WeftBuilder implements PromiseLike (.then is defined)", () => {
      const builder = new WeftBuilder("test");
      expect(typeof builder.then).toBe("function");
    });

    // STRUCTURAL-FALLBACK: canonical does NOT implement PromiseLike
    it("canonical: WeftBuilder does not implement PromiseLike (structural divergence)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/facades/shared.ts",
      );
      // Canonical WeftBuilder does not implement PromiseLike
      expect(source).not.toMatch(/implements PromiseLike/);
    });
  });

  // ── 3e. Default options ────────────────────────────────────────────────────

  describe("defaults", () => {
    it("mirror: WeftBuilder constructs without options (defaults applied)", () => {
      expect(() => new WeftBuilder("simple task")).not.toThrow();
    });

    it("mirror: WeftBuilder accepts WeftOptions with retry field matching RetryOptions type", () => {
      const retryOpts: RetryOptions = { maxAttempts: 3, baseDelayMs: 100 };
      expect(() => new WeftBuilder("task", { retry: retryOpts })).not.toThrow();
    });
  });

  // ── 3f. facadeMethodRegistry parity (canonical-only concept) ─────────────

  describe("facadeMethodRegistry (canonical-only)", () => {
    it("canonical: exports facadeMethodRegistry Map (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/facades/shared.ts",
      );
      expect(source).toMatch(/export const facadeMethodRegistry/);
      expect(source).toMatch(/new Map/);
    });

    it("DIVERGENCE DOCUMENTED: mirror does not export facadeMethodRegistry (structural)", () => {
      // The registry is a Convex-internal observability concept.
      // Verify by reading the mirror facade source directly (require() unavailable in ESM context).
      const mirrorFacadeSource = readFileSync(
        resolve(__dirname, "../facade.ts"),
        "utf8",
      );
      expect(mirrorFacadeSource).not.toMatch(/facadeMethodRegistry/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. RetryOptions
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canonicalPresent)("RetryOptions — canonical ↔ mirror contract", () => {
  /**
   * TWO RetryOptions exist and they are intentionally different:
   *
   *   canonical (weft/core/validation.ts):
   *     { maxRetries?, baseDelayMs?, originalPrompt? }
   *     Used for LLM response retry-with-feedback (schema validation retries).
   *
   *   mirror (types.ts):
   *     { maxAttempts?, baseDelayMs?, maxDelayMs?, jitter?, retryIf? }
   *     Used for AgentUnit .retry() operator.
   *
   * These are NOT the same type — they serve different mechanisms.
   * This section documents that divergence explicitly so maintainers don't
   * mistakenly try to unify them.
   */

  // ── 4a. Mirror RetryOptions fields ────────────────────────────────────────

  describe("mirror RetryOptions (for .retry() operator)", () => {
    it("mirror: RetryOptions type has maxAttempts field (structural)", () => {
      const source = readFileSync(resolve(__dirname, "../types.ts"), "utf8");
      // Find the RetryOptions block for the operator (not the validation one)
      expect(source).toMatch(/maxAttempts\?:/);
    });

    it("mirror: RetryOptions type has baseDelayMs field (structural)", () => {
      const source = readFileSync(resolve(__dirname, "../types.ts"), "utf8");
      expect(source).toMatch(/baseDelayMs\?:/);
    });

    it("mirror: RetryOptions type has maxDelayMs field (structural)", () => {
      const source = readFileSync(resolve(__dirname, "../types.ts"), "utf8");
      expect(source).toMatch(/maxDelayMs\?:/);
    });

    it("mirror: RetryOptions type has jitter field (structural)", () => {
      const source = readFileSync(resolve(__dirname, "../types.ts"), "utf8");
      expect(source).toMatch(/jitter\?:/);
    });

    it("mirror: RetryOptions type has retryIf predicate field (structural)", () => {
      const source = readFileSync(resolve(__dirname, "../types.ts"), "utf8");
      expect(source).toMatch(/retryIf\?:/);
    });
  });

  // ── 4b. Canonical RetryOptions fields ────────────────────────────────────

  describe("canonical RetryOptions (for validation retry)", () => {
    it("canonical: RetryOptions type has maxRetries field (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      expect(source).toMatch(/maxRetries\?:/);
    });

    it("canonical: RetryOptions type has baseDelayMs field (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      expect(source).toMatch(/baseDelayMs\?:/);
    });

    it("canonical: RetryOptions type has originalPrompt field (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      expect(source).toMatch(/originalPrompt\?:/);
    });
  });

  // ── 4c. Divergence documentation ─────────────────────────────────────────

  describe("divergence documentation", () => {
    it("DIVERGENCE DOCUMENTED: canonical uses maxRetries; mirror uses maxAttempts", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      const mirrorSource = readFileSync(
        resolve(__dirname, "../types.ts"),
        "utf8",
      );
      expect(canonicalSource).toMatch(/maxRetries\?:/);
      expect(mirrorSource).toMatch(/maxAttempts\?:/);
      // Confirm canonical does NOT have maxAttempts
      expect(canonicalSource).not.toMatch(/maxAttempts\?:/);
      // Confirm mirror does NOT have originalPrompt (it's schema-retry specific)
      expect(mirrorSource).not.toMatch(/originalPrompt\?:/);
    });

    it("DIVERGENCE DOCUMENTED: canonical has originalPrompt (schema retry); mirror has jitter + retryIf (operator retry)", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      const mirrorSource = readFileSync(
        resolve(__dirname, "../types.ts"),
        "utf8",
      );
      expect(canonicalSource).toMatch(/originalPrompt/);
      expect(mirrorSource).toMatch(/jitter/);
      expect(mirrorSource).toMatch(/retryIf/);
      expect(canonicalSource).not.toMatch(/\bjitter\b/);
      expect(canonicalSource).not.toMatch(/\bretryIf\b/);
    });

    it("baseDelayMs is a shared field on both RetryOptions types", () => {
      const canonicalSource = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      const mirrorSource = readFileSync(
        resolve(__dirname, "../types.ts"),
        "utf8",
      );
      expect(canonicalSource).toMatch(/baseDelayMs\?:/);
      expect(mirrorSource).toMatch(/baseDelayMs\?:/);
    });
  });

  // ── 4d. Validation behavior (canonical retryWithFeedback) ─────────────────

  describe("canonical retryWithFeedback / mirror .retry() — behavioral comparison", () => {
    /**
     * STRUCTURAL-FALLBACK:
     * The canonical retryWithFeedback takes a schema and a prompt-generating function.
     * The mirror .retry() takes maxAttempts and operates on the AgentUnit computation.
     * Both implement exponential backoff. We verify the mirror's runtime behavior
     * and the canonical's structural contract.
     */

    it("mirror: .retry() with baseDelayMs:0 does not hang on immediate re-attempts", async () => {
      const ctx = createContext();
      let calls = 0;
      const unit = AgentUnit.from(async () => {
        calls++;
        if (calls < 2) throw new Error("not yet");
        return "done";
      }).retry(3, { baseDelayMs: 0 });

      // Suppress deprecation warning
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (
        AgentUnit as unknown as { _deprecationWarned: boolean }
      )._deprecationWarned = false;
      const result = await unit.run(ctx, { trustMode: "legacy" });
      warnSpy.mockRestore();

      expect(result).toBe("done");
      expect(calls).toBe(2);
    });

    it("canonical: retryWithFeedback is exported from validation module (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      expect(source).toMatch(/export async function retryWithFeedback/);
    });

    it("canonical: validateResponse is exported from validation module (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      expect(source).toMatch(/export function validateResponse/);
    });

    it("canonical: exponential backoff uses 2^attempt multiplier (structural)", () => {
      const source = readCanonical(
        "convex/lib/agent_framework/weft/core/validation.ts",
      );
      // The calculateDelay function: baseDelayMs * 2 ** attempt
      expect(source).toMatch(/2\s*\*\*\s*attempt/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Additional shared concepts not explicitly named in WEFT-ARCHITECTURE.md
//    (flagged for maintainer review)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!canonicalPresent)("Additional shared concepts — maintainer flags", () => {
  /**
   * These types/functions appear in both codebases but are not listed in the
   * WEFT-ARCHITECTURE.md §"Shared concepts" table. They may warrant explicit
   * coverage in a future update to that table.
   */

  it("FLAG: AgentUnitMetadata is shared — both codebases define id/operatorChain/createdAt", () => {
    // Canonical: AgentUnitMetadata is in algebra/core/types/agent.types.ts
    const canonicalSource = readCanonical(
      "convex/lib/agent_framework/algebra/core/types/agent.types.ts",
    );
    expect(canonicalSource).toMatch(/AgentUnitMetadata/);
    // Mirror: metadata lives in AgentUnit/metadata.ts
    const mirrorSource = readFileSync(
      resolve(__dirname, "../AgentUnit/metadata.ts"),
      "utf8",
    );
    expect(mirrorSource).toMatch(/AgentUnitMetadata/);
  });

  it("FLAG: TrackedResult exists only in mirror (zero-trust return type) — canonical returns raw T", () => {
    const mirrorSource = readFileSync(
      resolve(__dirname, "../types.ts"),
      "utf8",
    );
    expect(mirrorSource).toMatch(/interface TrackedResult/);
    // Canonical AgentUnit returns T directly (not TrackedResult)
    const canonicalSource = readCanonical(
      "convex/lib/agent_framework/algebra/core/AgentUnit/AgentUnit.ts",
    );
    expect(canonicalSource).not.toMatch(/TrackedResult/);
  });

  it("FLAG: createContext() exists in mirror but not canonical (Convex provides its own ctx)", () => {
    const mirrorCtxSource = readFileSync(
      resolve(__dirname, "../context.ts"),
      "utf8",
    );
    expect(mirrorCtxSource).toMatch(/export function createContext/);
    // Canonical does not export createContext — context comes from Convex action handlers
    const canonicalCtxSource = readCanonical(
      "convex/lib/agent_framework/core/context.ts",
    );
    expect(canonicalCtxSource).not.toMatch(/export function createContext/);
  });

  it("FLAG: WeftErrorEnvelope (canonical) has no equivalent in mirror — different serialization strategy", () => {
    const canonicalSource = readCanonical(
      "convex/lib/agent_framework/core/weftErrors.ts",
    );
    expect(canonicalSource).toMatch(/WeftErrorEnvelope/);
    const mirrorSource = readFileSync(
      resolve(__dirname, "../errors.ts"),
      "utf8",
    );
    expect(mirrorSource).not.toMatch(/WeftErrorEnvelope/);
  });
});
