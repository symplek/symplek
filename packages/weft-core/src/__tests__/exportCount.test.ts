/**
 * @module exportCount - Gates the weft-core export count
 * @description Full public surface: teams, confidence, coherence, solo, rehearsal, contract, interview.
 *   runtime value count is 40–100 (types are erased at runtime and not counted).
 */
import { describe, expect, it } from "vitest";
import * as WeftCore from "../index";

describe("weft-core export count", () => {
  it("full public surface: runtime values should be 40-100 (types are erased, not counted)", () => {
    const exportCount = Object.keys(WeftCore).length;
    console.log(`Current weft-core runtime export count: ${exportCount}`);
    // export type {} declarations are erased at runtime — only runtime values are counted.
    // Surface includes: core, errors, context, teams, confidence, coherence, solo, rehearsal,
    // contract, interview utilities, version constants.
    expect(exportCount).toBeGreaterThanOrEqual(40);
    expect(exportCount).toBeLessThanOrEqual(100);
  });

  it("must include core runtime values (not empty stub)", () => {
    expect(WeftCore).toHaveProperty("AgentUnit");
    expect(WeftCore).toHaveProperty("WeftError");
    expect(WeftCore).toHaveProperty("createContext");
    expect(WeftCore).toHaveProperty("VERSION");
  });
});
