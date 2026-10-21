/**
 * @fileoverview Symplek Pro License Gate — behavior tests
 *
 * These tests exercise the real `validateLicense()` function and the
 * module-level gate. They replaced the original file which only tested
 * a local regex copy against string literals (audit finding T2/T10).
 *
 * The vitest env (vitest.config.ts) sets a format-valid SYMPLEK_PRO_LICENSE_KEY
 * so the static module-level gate passes for the whole test file. Tests that
 * probe the gate in isolation use vi.resetModules() + dynamic import.
 */
import { describe, expect, it, vi } from "vitest";

// Static import is safe here: vitest.config.ts injects a valid key before load.
import { isProLicensed, validateLicense } from "../license-gate";

// ─── validateLicense() — argument format validation ───────────────────────────

describe("validateLicense() — format validation", () => {
  it("accepts a lowercase 40-char hex key", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "a".repeat(40)),
    ).not.toThrow();
  });

  it("accepts any combination of valid lowercase hex digits", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "deadbeef0123456789abcdef0123456789abcdef"),
    ).not.toThrow();
  });

  it("rejects a key that is one char too short (39 body chars)", () => {
    // Fresh module needed: the already-validated state would short-circuit
    // an empty or undefined call, but a wrong-format key is always checked.
    expect(() =>
      validateLicense("symplek_pro_" + "a".repeat(39)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("rejects a key that is one char too long (41 body chars)", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "a".repeat(41)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("rejects a key with the wrong prefix", () => {
    expect(() =>
      validateLicense("invalid_prefix_" + "a".repeat(40)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("rejects a key with uppercase hex characters (case-sensitive)", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "A".repeat(40)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("rejects a key with non-hex characters in the body", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "z".repeat(40)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("rejects symplek_dev_ prefix (only symplek_pro_ is accepted)", () => {
    expect(() =>
      validateLicense("symplek_dev_" + "a".repeat(40)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });
});

// ─── isProLicensed() ─────────────────────────────────────────────────────────

describe("isProLicensed()", () => {
  it("returns a boolean", () => {
    expect(typeof isProLicensed()).toBe("boolean");
  });

  it("returns true after a successful validateLicense() call", () => {
    validateLicense("symplek_pro_" + "b".repeat(40));
    expect(isProLicensed()).toBe(true);
  });
});

// ─── Module-level gate (fresh module, via vi.resetModules) ───────────────────
// These tests reset the module registry and re-import to confirm the gate
// fires at module load time, before any user code runs.

describe("module-level gate behavior", () => {
  it("throws at import when no SYMPLEK_PRO_LICENSE_KEY is set", async () => {
    vi.resetModules();
    const saved = process.env["SYMPLEK_PRO_LICENSE_KEY"];
    delete process.env["SYMPLEK_PRO_LICENSE_KEY"];

    // The remedy named in the error must be one the caller can reach: the
    // import has failed, so nothing exported from the package can be called.
    await expect(import("../license-gate")).rejects.toThrow(
      /Set the SYMPLEK_PRO_LICENSE_KEY environment variable before importing @symplek/pro/,
    );
    await expect(import("../license-gate")).rejects.not.toThrow(/validateLicense/);

    if (saved !== undefined) process.env["SYMPLEK_PRO_LICENSE_KEY"] = saved;
    vi.resetModules();
  });

  it("does NOT throw at import when SYMPLEK_PRO_LICENSE_KEY is a valid-format key", async () => {
    vi.resetModules();
    process.env["SYMPLEK_PRO_LICENSE_KEY"] = "symplek_pro_" + "c".repeat(40);

    const mod = await import("../license-gate");
    expect(typeof mod.validateLicense).toBe("function");
    expect(typeof mod.isProLicensed).toBe("function");

    vi.resetModules();
  });

  it("names the format problem when SYMPLEK_PRO_LICENSE_KEY is set but malformed", async () => {
    vi.resetModules();
    const saved = process.env["SYMPLEK_PRO_LICENSE_KEY"];
    process.env["SYMPLEK_PRO_LICENSE_KEY"] = "wrong_format_key";

    const failure = await import("../license-gate").then(
      () => null,
      (error: Error) => error,
    );
    expect(failure?.message).toMatch(/Invalid Symplek Pro license key format/);
    // The key is a secret: no part of it may be echoed into an error or a log.
    expect(failure?.message).not.toContain("wrong_format");

    if (saved !== undefined) process.env["SYMPLEK_PRO_LICENSE_KEY"] = saved;
    vi.resetModules();
  });
});

// ─── Key format contract (documented in README) ──────────────────────────────

describe("key format contract — prefix and body length", () => {
  it("requires prefix 'symplek_pro_' (9 chars)", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "a".repeat(40)),
    ).not.toThrow();
    expect(() =>
      validateLicense("symplek_XXX_" + "a".repeat(40)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });

  it("requires exactly 40 chars after the prefix", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "f".repeat(40)),
    ).not.toThrow();
    expect(() =>
      validateLicense("symplek_pro_" + "f".repeat(39)),
    ).toThrow();
    expect(() =>
      validateLicense("symplek_pro_" + "f".repeat(41)),
    ).toThrow();
  });

  it("body accepts [a-f0-9] only", () => {
    expect(() =>
      validateLicense("symplek_pro_" + "abcdef0123".repeat(4)),
    ).not.toThrow();
    expect(() =>
      validateLicense("symplek_pro_" + "ABCDEF0123".repeat(4)),
    ).toThrow(/Invalid Symplek Pro license key format/);
  });
});
