/**
 * @module validateInput.adversarial.test - Adversarial suite for the MCP input validator
 * @description B5: validateInput.ts is the sole guard on untrusted tools/call arguments.
 *   Every case here tries to defeat the validator. A suite that only feeds it valid input
 *   is worthless; this suite asserts REJECTION of what must be rejected.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { describe, expect, it } from "vitest";

import { debateTool } from "../tools/debate.tool";
import {
  type JsonSchemaLike,
  ValidationError,
  validateInput,
} from "../validateInput";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The input schema weft_debate advertises, as the server validates against it. */
const DEBATE_SCHEMA = debateTool.inputSchema as unknown as JsonSchemaLike;

function expectReject(value: unknown, schema: JsonSchemaLike): void {
  expect(() => validateInput(value, schema)).toThrow(ValidationError);
}

function expectPass(value: unknown, schema: JsonSchemaLike): void {
  expect(() => validateInput(value, schema)).not.toThrow();
}

// Build a schema with `depth` levels of nested object properties
function makeDeepObjectSchema(depth: number): JsonSchemaLike {
  if (depth === 0) return { type: "string" };
  return { type: "object", properties: { child: makeDeepObjectSchema(depth - 1) } };
}

// Build a value with `depth` levels of nesting
function makeDeepObjectValue(depth: number): unknown {
  if (depth === 0) return "leaf";
  return { child: makeDeepObjectValue(depth - 1) };
}

// ─── Malformed / null / undefined inputs ─────────────────────────────────────

describe("malformed inputs against object schema", () => {
  const schema: JsonSchemaLike = { type: "object" };

  it("rejects null", () => expectReject(null, schema));
  it("rejects undefined", () => expectReject(undefined, schema));
  it("rejects a string", () => expectReject("hello", schema));
  it("rejects a number", () => expectReject(42, schema));
  it("rejects a boolean", () => expectReject(true, schema));
  it("rejects an array", () => expectReject([], schema));
});

describe("malformed inputs against string schema", () => {
  const schema: JsonSchemaLike = { type: "string" };

  it("rejects null", () => expectReject(null, schema));
  it("rejects a number", () => expectReject(7, schema));
  it("rejects an object", () => expectReject({}, schema));
  it("rejects an array", () => expectReject(["a"], schema));
  it("rejects a boolean", () => expectReject(false, schema));
});

describe("malformed inputs against number schema", () => {
  const schema: JsonSchemaLike = { type: "number" };

  it("rejects a string that looks numeric", () => expectReject("42", schema));
  it("rejects an object", () => expectReject({ value: 1 }, schema));
  it("rejects null", () => expectReject(null, schema));
});

// ─── Depth-bomb payloads ──────────────────────────────────────────────────────

describe("depth-bomb payloads (DEFAULT_MAX_OBJECT_DEPTH = 16)", () => {
  it("passes a payload at exactly depth 16", () => {
    expectPass(makeDeepObjectValue(16), makeDeepObjectSchema(16));
  });

  it("rejects a payload at depth 17 (one over limit)", () => {
    // The 17th validateAt call fires at depth > 16
    expectReject(makeDeepObjectValue(17), makeDeepObjectSchema(17));
  });

  it("rejects a payload at depth 20", () => {
    expectReject(makeDeepObjectValue(20), makeDeepObjectSchema(20));
  });

  it("rejects deeply nested arrays via items schema", () => {
    // Build schema: array of arrays of … of string (20 levels deep)
    const arraySchema = (depth: number): JsonSchemaLike =>
      depth === 0 ? { type: "string" } : { type: "array", items: arraySchema(depth - 1) };
    const arrayValue = (depth: number): unknown =>
      depth === 0 ? "x" : [arrayValue(depth - 1)];

    expectReject(arrayValue(20), arraySchema(20));
  });
});

// ─── Boundary conditions: maxLength ──────────────────────────────────────────

describe("string maxLength boundary", () => {
  const schema: JsonSchemaLike = { type: "string", maxLength: 10 };

  it("passes a string at exactly maxLength (10)", () => {
    expectPass("a".repeat(10), schema);
  });

  it("rejects a string one char over maxLength (11)", () => {
    expectReject("a".repeat(11), schema);
  });

  it("rejects a very long string", () => {
    expectReject("x".repeat(1_000), schema);
  });
});

describe("default maxLength boundary (32 768)", () => {
  const schema: JsonSchemaLike = { type: "string" }; // no explicit maxLength

  it("passes a string at exactly DEFAULT_MAX_STRING_LENGTH (32 768)", () => {
    expectPass("a".repeat(32_768), schema);
  });

  it("rejects a string one char over DEFAULT_MAX_STRING_LENGTH (32 769)", () => {
    expectReject("a".repeat(32_769), schema);
  });
});

// ─── Boundary conditions: maxItems ───────────────────────────────────────────

describe("array maxItems boundary", () => {
  const schema: JsonSchemaLike = { type: "array", maxItems: 5, items: { type: "number" } };

  it("passes an array at exactly maxItems (5)", () => {
    expectPass([1, 2, 3, 4, 5], schema);
  });

  it("rejects an array one item over maxItems (6)", () => {
    expectReject([1, 2, 3, 4, 5, 6], schema);
  });
});

describe("default maxItems boundary (256)", () => {
  const schema: JsonSchemaLike = { type: "array" }; // no explicit maxItems

  it("passes an array at exactly DEFAULT_MAX_ARRAY_LENGTH (256)", () => {
    expectPass(new Array(256).fill(1), schema);
  });

  it("rejects an array one item over DEFAULT_MAX_ARRAY_LENGTH (257)", () => {
    expectReject(new Array(257).fill(1), schema);
  });
});

// ─── Type confusion ───────────────────────────────────────────────────────────

describe("type confusion attacks", () => {
  it("rejects array where object schema expected", () => {
    expectReject([], { type: "object" });
  });

  it("rejects object where array schema expected", () => {
    expectReject({}, { type: "array" });
  });

  it("rejects string where boolean schema expected", () => {
    expectReject("true", { type: "boolean" });
  });

  it("rejects 0/1 where boolean schema expected", () => {
    expectReject(0, { type: "boolean" });
    expectReject(1, { type: "boolean" });
  });

  it("rejects a JSON-stringified object where object schema expected", () => {
    // e.g. caller sends '{"a":1}' hoping the validator coerces it
    expectReject('{"a":1}', { type: "object" });
  });

  it("rejects array-in-required-property", () => {
    const schema: JsonSchemaLike = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    expectReject({ name: ["not", "a", "string"] }, schema);
  });
});

// ─── Undeclared-property bypass ───────────────────────────────────────────────

describe("undeclared property handling", () => {
  // JSON Schema allows additional properties by default — the validator must
  // not reject them, but it also must not recurse into them and execute anything.
  const schema: JsonSchemaLike = {
    type: "object",
    properties: { allowed: { type: "string" } },
    required: ["allowed"],
  };

  it("passes an object with extra undeclared properties", () => {
    expectPass({ allowed: "yes", extra: { deeply: { nested: true } } }, schema);
  });

  it("still validates declared properties even when extras are present", () => {
    expectReject(
      { allowed: 999, extra: "ignored" }, // allowed must be string
      schema,
    );
  });

  it("still enforces required properties even when extras are present", () => {
    expectReject({ extra: "present" }, schema); // missing required 'allowed'
  });
});

// ─── Prototype-pollution shaped keys ─────────────────────────────────────────

describe("prototype-pollution shaped keys", () => {
  // The validator reads schema.properties keys (controlled by us) and looks
  // them up with `key in obj` / `obj[key]`. It never iterates input object keys.
  // These tests assert the validator doesn't break or allow pollution.

  it("passes __proto__ as an undeclared extra property without breaking validation", () => {
    const schema: JsonSchemaLike = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    // The __proto__ key should be treated as an undeclared extra property
    const value = JSON.parse('{"name":"ok","__proto__":{"isAdmin":true}}') as unknown;
    expectPass(value, schema);
    // Verify prototype was not polluted
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it("passes constructor key as an undeclared extra property", () => {
    const schema: JsonSchemaLike = {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    };
    expectPass(
      JSON.parse('{"prompt":"ok","constructor":{"name":"hacked"}}') as unknown,
      schema,
    );
  });

  it("passes toString key as an undeclared extra property", () => {
    const schema: JsonSchemaLike = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    };
    expectPass({ text: "hello", toString: "overwritten" }, schema);
  });
});

// ─── Number boundary conditions ──────────────────────────────────────────────

describe("number minimum/maximum boundaries", () => {
  const schema: JsonSchemaLike = { type: "number", minimum: 0, maximum: 1 };

  it("passes a value at exactly minimum (0)", () => expectPass(0, schema));
  it("passes a value at exactly maximum (1)", () => expectPass(1, schema));
  it("passes a value strictly inside the range", () => expectPass(0.5, schema));
  it("rejects a value one unit below minimum (-0.001)", () => expectReject(-0.001, schema));
  it("rejects a value one unit above maximum (1.001)", () => expectReject(1.001, schema));
  it("rejects a large negative value", () => expectReject(-9999, schema));
  it("rejects a large positive value", () => expectReject(9999, schema));
});

describe("non-finite number rejection", () => {
  const schema: JsonSchemaLike = { type: "number" };

  it("rejects NaN", () => expectReject(NaN, schema));
  it("rejects Infinity", () => expectReject(Infinity, schema));
  it("rejects negative Infinity", () => expectReject(-Infinity, schema));
  it("rejects NaN even with minimum/maximum constraints", () => {
    expectReject(NaN, { type: "number", minimum: 0, maximum: 100 });
  });
});

// ─── Integer type (Smaller: rounds: 1.5 accepted) ────────────────────────────
// The standard JSON Schema "integer" type. An earlier version of the validator
// spelled this as a non-standard `integer: true` keyword on a "number"; that
// keyword is gone, and these cases now run against the standard type.

describe("integer type (Smaller: fractional rounds accepted)", () => {
  const schema: JsonSchemaLike = {
    type: "integer",
    minimum: 1,
    maximum: 16,
  };

  it("passes an integer value (2)", () => expectPass(2, schema));
  it("passes the minimum integer (1)", () => expectPass(1, schema));
  it("passes the maximum integer (16)", () => expectPass(16, schema));

  it("rejects a fractional value (1.5)", () => expectReject(1.5, schema));
  it("rejects a fractional value (2.001)", () => expectReject(2.001, schema));
  it("rejects a fractional value below minimum (0.5)", () =>
    expectReject(0.5, schema));
  it("rejects a string that looks like an integer", () =>
    expectReject("2", schema));
  it("rejects an integer outside the range (17)", () =>
    expectReject(17, schema));

  it("the number type allows fractional values", () => {
    expectPass(1.5, { type: "number", minimum: 1, maximum: 16 });
  });

  it("says what was wrong when a fraction arrives where an integer is wanted", () => {
    expect(() => validateInput(1.5, schema)).toThrow(/expected integer, got number 1\.5/);
  });

  it("the real weft_debate rounds schema rejects 1.5 and accepts 2", () => {
    const rounds = (DEBATE_SCHEMA.properties as Record<string, JsonSchemaLike>)
      .rounds;
    expectReject(1.5, rounds);
    expectPass(2, rounds);
  });
});

// ─── Enum validation ──────────────────────────────────────────────────────────

describe("enum validation", () => {
  const schema: JsonSchemaLike = { type: "string", enum: ["alpha", "beta", "gamma"] };

  it("passes a value that is in the enum", () => expectPass("alpha", schema));
  it("rejects a value not in the enum", () => expectReject("delta", schema));
  it("rejects an empty string when not in enum", () => expectReject("", schema));
  it("rejects a case variant not in the enum", () => expectReject("Alpha", schema));

  const numEnum: JsonSchemaLike = { type: "number", enum: [1, 2, 3] };
  it("passes a number in a numeric enum", () => expectPass(2, numEnum));
  it("rejects a number not in a numeric enum", () => expectReject(4, numEnum));
});

// ─── Required property validation ────────────────────────────────────────────

describe("required property missing", () => {
  const schema: JsonSchemaLike = {
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "number" },
      c: { type: "boolean" },
    },
    required: ["a", "b", "c"],
  };

  it("passes when all required properties are present", () => {
    expectPass({ a: "hello", b: 1, c: true }, schema);
  });

  it("rejects when one required property is missing", () => {
    expectReject({ a: "hello", b: 1 }, schema); // missing c
  });

  it("rejects when all required properties are missing", () => {
    expectReject({}, schema);
  });

  it("rejects when required property is present but undefined", () => {
    expectReject({ a: undefined, b: 1, c: true }, schema);
  });
});

// ─── Nested validation ────────────────────────────────────────────────────────

describe("nested property validation", () => {
  const schema: JsonSchemaLike = {
    type: "object",
    properties: {
      meta: {
        type: "object",
        properties: {
          count: { type: "number", minimum: 0 },
          label: { type: "string", maxLength: 20 },
        },
        required: ["count"],
      },
    },
    required: ["meta"],
  };

  it("passes a valid nested object", () => {
    expectPass({ meta: { count: 5, label: "ok" } }, schema);
  });

  it("rejects invalid nested property type", () => {
    expectReject({ meta: { count: "not-a-number" } }, schema);
  });

  it("rejects nested number below minimum", () => {
    expectReject({ meta: { count: -1 } }, schema);
  });

  it("rejects nested string over maxLength", () => {
    expectReject({ meta: { count: 1, label: "x".repeat(21) } }, schema);
  });

  it("rejects missing nested required property", () => {
    expectReject({ meta: { label: "no-count" } }, schema);
  });
});

describe("array item validation", () => {
  const schema: JsonSchemaLike = {
    type: "array",
    items: { type: "string", maxLength: 8 },
    maxItems: 4,
  };

  it("passes a valid array of short strings", () => {
    expectPass(["ab", "cd"], schema);
  });

  it("rejects an item that fails the item schema (9 chars, over maxLength 8)", () => {
    // "toolong!!" = 9 chars → exceeds maxLength: 8
    expectReject(["ok", "toolong!!", "x"], schema);
  });

  it("rejects an array that exceeds maxItems", () => {
    expectReject(["a", "b", "c", "d", "e"], schema);
  });
});

// ─── Real-world tool schema smoke tests ──────────────────────────────────────

describe("real tool input schema — weft_debate", () => {
  // The schema the tool advertises, not a copy of it: a copy kept passing
  // after the real one changed.
  const debateSchema = DEBATE_SCHEMA;

  it("rejects a fractional rounds value (1.5)", () => {
    expectReject(
      { prompt: "ok", roles: [{ role: "a", model: "b" }], rounds: 1.5 },
      debateSchema,
    );
  });

  it("passes valid debate input", () => {
    expectPass(
      { prompt: "Debate this", roles: [{ role: "dev", model: "gpt-4" }], rounds: 2 },
      debateSchema,
    );
  });

  it("rejects oversized prompt (depth-bomb string)", () => {
    expectReject({ prompt: "x".repeat(16_385), roles: [] }, debateSchema);
  });

  it("rejects too many roles (over maxItems 32)", () => {
    const roles = Array.from({ length: 33 }, (_, i) => ({
      role: `role${i}`,
      model: "gpt-4",
    }));
    expectReject({ prompt: "ok", roles }, debateSchema);
  });

  it("rejects invalid rounds value (0, below minimum)", () => {
    expectReject(
      { prompt: "ok", roles: [{ role: "a", model: "b" }], rounds: 0 },
      debateSchema,
    );
  });

  it("rejects rounds above maximum (17)", () => {
    expectReject(
      { prompt: "ok", roles: [{ role: "a", model: "b" }], rounds: 17 },
      debateSchema,
    );
  });

  it("rejects a role missing the required 'model' field", () => {
    expectReject({ prompt: "ok", roles: [{ role: "dev" }] }, debateSchema);
  });

  it("rejects non-string role.role", () => {
    expectReject(
      { prompt: "ok", roles: [{ role: 42, model: "gpt-4" }] },
      debateSchema,
    );
  });

  it("rejects session_id over maxLength 128", () => {
    expectReject(
      {
        prompt: "ok",
        roles: [{ role: "a", model: "b" }],
        session_id: "x".repeat(129),
      },
      debateSchema,
    );
  });
});

describe("real tool input schema — weft_consensus", () => {
  const consensusSchema: JsonSchemaLike = {
    type: "object",
    properties: {
      prompt: { type: "string", maxLength: 16_384 },
      voters: {
        type: "array",
        items: { type: "string", maxLength: 256 },
        maxItems: 32,
      },
      threshold: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["prompt", "voters", "threshold"],
  };

  it("passes valid consensus input", () => {
    expectPass(
      { prompt: "approve?", voters: ["alice", "bob"], threshold: 0.6 },
      consensusSchema,
    );
  });

  it("rejects threshold below 0 (negative)", () => {
    expectReject(
      { prompt: "ok", voters: ["a"], threshold: -0.1 },
      consensusSchema,
    );
  });

  it("rejects threshold above 1", () => {
    expectReject({ prompt: "ok", voters: ["a"], threshold: 1.1 }, consensusSchema);
  });

  it("rejects NaN threshold", () => {
    expectReject({ prompt: "ok", voters: ["a"], threshold: NaN }, consensusSchema);
  });

  it("rejects voter name over maxLength 256", () => {
    expectReject(
      { prompt: "ok", voters: ["v".repeat(257)], threshold: 0.5 },
      consensusSchema,
    );
  });
});

describe("real tool input schema — weft_tracked", () => {
  const trackedSchema: JsonSchemaLike = {
    type: "object",
    properties: {
      prompt: { type: "string", maxLength: 16_384 },
      source: { type: "string", maxLength: 2_048 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["prompt", "source", "confidence"],
  };

  it("passes valid tracked input", () => {
    expectPass(
      { prompt: "claim", source: "file:///src/x.ts", confidence: 0.9 },
      trackedSchema,
    );
  });

  it("rejects confidence above 1", () => {
    expectReject(
      { prompt: "ok", source: "file://a", confidence: 1.01 },
      trackedSchema,
    );
  });

  it("rejects confidence below 0", () => {
    expectReject(
      { prompt: "ok", source: "file://a", confidence: -0.01 },
      trackedSchema,
    );
  });

  it("rejects source over maxLength 2048", () => {
    expectReject(
      { prompt: "ok", source: "s".repeat(2_049), confidence: 0.5 },
      trackedSchema,
    );
  });

  it("rejects missing required 'source' field", () => {
    expectReject({ prompt: "ok", confidence: 0.5 }, trackedSchema);
  });
});
