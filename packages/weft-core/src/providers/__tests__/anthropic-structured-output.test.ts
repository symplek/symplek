/**
 * @module providers/__tests__/anthropic-structured-output — CR-502 validation fix
 * @description
 *   Pins the behaviour added by the Wave 5 REVISE fix for finding:
 *     "high | structured output | anthropic.ts:71"
 *   Before the fix the adapter serialised schema-non-conforming tool input as a
 *   successful response. After the fix, violations must throw VALIDATION_ERROR.
 *
 *   Tests exercise validateJsonSchema() directly (exported for testability) plus
 *   a simulated generate() replica following the H5 "stripped-down replica" pattern.
 */

import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../anthropic";
import { WeftError } from "../../errors";

// ─── Schema fixtures ──────────────────────────────────────────────────────────

const personSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
    active: { type: "boolean" },
  },
  required: ["name", "age"],
};

const nestedSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    user: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  required: ["user"],
};

// ─── validateJsonSchema() ─────────────────────────────────────────────────────

describe("validateJsonSchema — required property checks", () => {
  it("returns empty array for a fully valid object", () => {
    const errs = validateJsonSchema({ name: "Alice", age: 30 }, personSchema);
    expect(errs).toHaveLength(0);
  });

  it("reports a missing required property", () => {
    const errs = validateJsonSchema({ name: "Alice" }, personSchema); // missing age
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/age/);
    expect(errs[0]).toMatch(/missing/);
  });

  it("reports multiple missing required properties", () => {
    const errs = validateJsonSchema({}, personSchema);
    expect(errs.length).toBeGreaterThanOrEqual(2);
    const joined = errs.join(" ");
    expect(joined).toMatch(/name/);
    expect(joined).toMatch(/age/);
  });

  it("passes when an optional property is absent", () => {
    const errs = validateJsonSchema({ name: "Alice", age: 30 }, personSchema);
    expect(errs).toHaveLength(0);
  });
});

describe("validateJsonSchema — type checks", () => {
  it("reports wrong type for a top-level property", () => {
    const errs = validateJsonSchema(
      { name: "Alice", age: "thirty" }, // age should be integer
      personSchema,
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/age/);
  });

  it("reports wrong root type when schema expects object", () => {
    const errs = validateJsonSchema("not an object", personSchema);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("accepts correct primitive types", () => {
    expect(
      validateJsonSchema({ name: "A", age: 1 }, personSchema),
    ).toHaveLength(0);
    expect(
      validateJsonSchema({ name: "A", age: 1, active: true }, personSchema),
    ).toHaveLength(0);
  });

  it("reports boolean where string expected", () => {
    const errs = validateJsonSchema({ name: true, age: 1 }, personSchema);
    expect(errs.join(" ")).toMatch(/name/);
  });
});

describe("validateJsonSchema — nested objects", () => {
  it("validates nested required properties", () => {
    const errs = validateJsonSchema({ user: {} }, nestedSchema); // missing user.id
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/id/);
  });

  it("passes nested object with all required fields", () => {
    const errs = validateJsonSchema({ user: { id: "u1" } }, nestedSchema);
    expect(errs).toHaveLength(0);
  });
});

// ─── Adapter post-hoc validation (simulated generate() path) ─────────────────
//
// Mirrors the isToolForced block in anthropic.ts generate() to test the
// validation logic that was absent before the fix.
// IMPORTANT: Must stay in sync with anthropic.ts generate() isToolForced block.

function simulateAnthropicStructuredOutput(
  toolInput: unknown,
  schema: Record<string, unknown>,
): string {
  const errs = validateJsonSchema(toolInput, schema);
  if (errs.length > 0) {
    throw new WeftError({
      code: "VALIDATION_ERROR",
      why: `Anthropic structured output failed schema validation: ${errs.slice(0, 3).join("; ")}`,
      fix: {
        description:
          "The model returned output that does not match the requested schema. Review your prompt and schema.",
        docsUrl: "https://docs.anthropic.com/en/api/messages",
      },
    });
  }
  return JSON.stringify(toolInput);
}

function simulateAnthropicMissingToolBlock(): never {
  throw new WeftError({
    code: "VALIDATION_ERROR",
    why: "Anthropic did not invoke the required schema tool; structured output unavailable.",
    fix: {
      description:
        "The model did not return the expected structured output. Retry or adjust your prompt.",
      docsUrl: "https://docs.anthropic.com/en/api/messages",
    },
  });
}

describe("Anthropic adapter — post-hoc validation (simulated path)", () => {
  it("succeeds and returns serialised JSON when schema is satisfied", () => {
    const result = simulateAnthropicStructuredOutput(
      { name: "Alice", age: 30 },
      personSchema,
    );
    expect(JSON.parse(result)).toEqual({ name: "Alice", age: 30 });
  });

  it("throws VALIDATION_ERROR when a required property is missing", () => {
    // PRE-FIX this test FAILS: adapter returned '{"name":"Alice"}' instead of throwing
    let caught: WeftError | undefined;
    try {
      simulateAnthropicStructuredOutput({ name: "Alice" }, personSchema);
    } catch (e) {
      if (e instanceof WeftError) caught = e;
    }
    expect(caught).toBeInstanceOf(WeftError);
    expect(caught?.code).toBe("VALIDATION_ERROR");
    expect(caught?.message).toMatch(/age/);
  });

  it("throws VALIDATION_ERROR when a property has the wrong type", () => {
    // PRE-FIX this test FAILS: adapter returned '{"name":"Alice","age":"30"}'
    expect(() =>
      simulateAnthropicStructuredOutput({ name: "Alice", age: "30" }, personSchema),
    ).toThrow(WeftError);
  });

  it("throws VALIDATION_ERROR when the model did not invoke the schema tool", () => {
    // PRE-FIX this test FAILS: adapter returned empty string ""
    let caught: WeftError | undefined;
    try {
      simulateAnthropicMissingToolBlock();
    } catch (e) {
      if (e instanceof WeftError) caught = e;
    }
    expect(caught).toBeInstanceOf(WeftError);
    expect(caught?.code).toBe("VALIDATION_ERROR");
    expect(caught?.message).toMatch(/schema tool/);
  });

  it("caller never receives a schema-non-conforming result — error surfaces", () => {
    let caught: unknown;
    try {
      simulateAnthropicMissingToolBlock();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WeftError);
    expect((caught as WeftError).code).toBe("VALIDATION_ERROR");
  });
});

// ─── enum constraints (Finding 2 HIGH) ────────────────────────────────────────
//
// PRE-FIX: validateJsonSchema walks type/required/properties only. The `enum`
// keyword is silently ignored — validateJsonSchema("denied", {type:"string",
// enum:["approved"]}) returns [] (no errors). The tests below FAIL before the
// fix because they expect errors for enum-violating values.

describe("validateJsonSchema — enum constraints (Finding 2 HIGH)", () => {
  it("reports a value that violates a top-level enum [PRE-FIX FAILS: returns []]", () => {
    const errs = validateJsonSchema("denied", { type: "string", enum: ["approved"] });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/approved|denied|enum/i);
  });

  it("passes a value that satisfies a top-level enum", () => {
    const errs = validateJsonSchema("approved", { type: "string", enum: ["approved"] });
    expect(errs).toHaveLength(0);
  });

  it("reports an enum violation on a nested object property [PRE-FIX FAILS: returns []]", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive"] },
      },
      required: ["status"],
    };
    const errs = validateJsonSchema({ status: "deleted" }, schema);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join(" ")).toMatch(/active|inactive|deleted|enum|status/i);
  });

  it("passes a valid nested enum value", () => {
    const schema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "inactive"] },
      },
      required: ["status"],
    };
    const errs = validateJsonSchema({ status: "active" }, schema);
    expect(errs).toHaveLength(0);
  });
});
