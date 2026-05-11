/**
 * @module boundaryTest - Confirms open-core boundary: server-only symbols absent from weft-core root
 * @description The root barrel is the client-safe / MIT-licensed surface.
 * Server-only facades (Weft, WeftBuilder, providerRegistry) must NOT appear here.
 * Teams, rehearsal, and confidence/coherence utilities ARE part of the public root surface
 * per the contractSmoke contract — supersedes Wave 3 trimming decisions.
 */
import { describe, expect, it } from "vitest";
import * as WeftCore from "../index";

describe("weft-core open-core boundary", () => {
  const exportNames = Object.keys(WeftCore);

  it("does not export createDebateComputation (internal implementation detail)", () => {
    expect(exportNames).not.toContain("createDebateComputation");
  });

  it("does not export server-only Weft facade (moved to weft-core/server)", () => {
    expect(exportNames).not.toContain("Weft");
    expect(exportNames).not.toContain("WeftBuilder");
  });

  it("does not export providerRegistry (server-only)", () => {
    expect(exportNames).not.toContain("providerRegistry");
    expect(exportNames).not.toContain("ProviderRegistry");
  });

  it("exports the core AgentUnit API", () => {
    expect(exportNames).toContain("AgentUnit");
  });

  it("exports Teams public surface", () => {
    expect(exportNames).toContain("Team");
    expect(exportNames).toContain("TeamRegistry");
    expect(exportNames).toContain("teams");
  });

  it("exports CoherenceError (part of public contract)", () => {
    expect(exportNames).toContain("CoherenceError");
  });
});
