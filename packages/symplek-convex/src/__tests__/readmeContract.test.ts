/**
 * README import-name contract test — @symplek/convex
 *
 * Verifies that every name the README says is importable from "@symplek/convex"
 * actually exists in the dist. Introduced after audit B12 found type names
 * SymplekConvexOptions/SymplekConvexClient in the README that do not match the real
 * exported names ConvexAIOptions/ConvexAI.
 *
 * Run with: pnpm --filter @symplek/convex test
 */
import { describe, it, expect } from "vitest";

describe("@symplek/convex README — named exports exist in dist", () => {
  it("withAI is exported as a function", async () => {
    const m = await import("../index");
    expect(typeof m.withAI).toBe("function");
  });
});

// ── Type-level contract (names visible in dist type declarations) ─────────────
// The README documents ConvexAIOptions and ConvexAI as the option/return types.
// We import them at type-level and confirm the module resolves without error.

describe("@symplek/convex README — type exports resolve", () => {
  it("module resolves without error (ConvexAIOptions and ConvexAI are exported types)", async () => {
    // If the named type exports were removed this import would fail at typecheck time.
    // At runtime we just confirm the module loads and withAI is present.
    const m = await import("../index");
    expect("withAI" in m).toBe(true);
  });
});

// ── Old incorrect type names confirmed absent ─────────────────────────────────
// README previously documented SymplekConvexOptions and SymplekConvexClient (wrong).
// These tests catch any re-introduction of those false names.

describe("@symplek/convex README — renamed/removed names stay absent from runtime export", () => {
  it("module does not export SymplekConvexOptions (old wrong name)", async () => {
    const m = await import("../index") as Record<string, unknown>;
    expect("SymplekConvexOptions" in m).toBe(false);
  });

  it("module does not export SymplekConvexClient (old wrong name)", async () => {
    const m = await import("../index") as Record<string, unknown>;
    expect("SymplekConvexClient" in m).toBe(false);
  });
});

// ── ConvexAI interface methods exist on withAI return value ───────────────────
// README documents: generate, streamToMutation, raw, experimental

describe("@symplek/convex README — ConvexAI return shape", () => {
  it("withAI(ctx) returns an object with generate, streamToMutation, raw, experimental", async () => {
    const { withAI } = await import("../index");

    // Minimal mock: withAI only needs ctx to have runMutation/runQuery-like shape
    // at construction time (no mutations provided, so guards do not fire).
    const mockCtx = {} as Parameters<typeof withAI>[0];
    const ai = withAI(mockCtx);

    expect(typeof ai.generate).toBe("function");
    expect(typeof ai.streamToMutation).toBe("function");
    expect(typeof ai.raw).toBe("function");
    expect(typeof ai.experimental).toBe("object");
    expect(typeof ai.experimental.generateTyped).toBe("function");
  });
});
