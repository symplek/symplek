/**
 * @module exportCount - Gates the @symplek/core export count
 * @description Full public surface: teams, confidence, coherence, solo, rehearsal, contract, interview.
 *   runtime value count is 40–120 (types are erased at runtime and not counted).
 */
import { describe, expect, it } from "vitest";
import * as SymplekCore from "../index";

describe("@symplek/core export count", () => {
  it("full public surface: runtime values should be 40-120 (types are erased, not counted)", () => {
    const exportCount = Object.keys(SymplekCore).length;
    console.log(`Current @symplek/core runtime export count: ${exportCount}`);
    // export type {} declarations are erased at runtime — only runtime values are counted.
    // Surface includes: core, errors, context, teams, confidence, coherence, solo, rehearsal,
    // contract, interview utilities, version constants.
    expect(exportCount).toBeGreaterThanOrEqual(40);
    expect(exportCount).toBeLessThanOrEqual(120);
  });

  it("must include core runtime values (not empty stub)", () => {
    expect(SymplekCore).toHaveProperty("AgentUnit");
    expect(SymplekCore).toHaveProperty("SymplekError");
    expect(SymplekCore).toHaveProperty("createContext");
    expect(SymplekCore).toHaveProperty("VERSION");
  });
});
