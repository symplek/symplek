/**
 * @module executor.test - Unit tests for zodSchemaToJsonSchema() in executor.ts
 * @description Verifies that tool-parameter serialisation uses only public Zod v3
 *   APIs (no ._def access) and produces well-formed JSON Schema objects.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodSchemaToJsonSchema } from "../agent/executor";

describe("zodSchemaToJsonSchema — public-API Zod v3 conversion", () => {
  it("converts a simple z.object with string and number fields", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.type).toBe("object");
    expect(result!.properties.name).toEqual({ type: "string" });
    expect(result!.properties.age).toEqual({ type: "number" });
    expect(result!.required).toContain("name");
    expect(result!.required).toContain("age");
  });

  it("marks optional fields as not required", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.number().optional(),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.required).toContain("required");
    expect(result!.required).not.toContain("optional");
    // The optional field is still present in properties
    expect(result!.properties.optional).toEqual({ type: "number" });
  });

  it("handles boolean fields", () => {
    const schema = z.object({ active: z.boolean() });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.properties.active).toEqual({ type: "boolean" });
  });

  it("returns undefined for non-object root types (e.g. z.string())", () => {
    const result = zodSchemaToJsonSchema(z.string());
    expect(result).toBeUndefined();
  });

  it("returns undefined for z.array() root (unsupported top-level type)", () => {
    const result = zodSchemaToJsonSchema(z.array(z.string()));
    expect(result).toBeUndefined();
  });

  it("produces a valid JSON-schema-shaped object (type + properties + required)", () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    });

    const result = zodSchemaToJsonSchema(schema);

    // Shape guard: must be a JSON Schema object node
    expect(result).toMatchObject({
      type: "object",
      properties: expect.any(Object),
      required: expect.any(Array),
    });
  });

  it("handles nested z.object fields", () => {
    const schema = z.object({
      address: z.object({
        street: z.string(),
        zip: z.string(),
      }),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.properties.address).toMatchObject({
      type: "object",
      properties: {
        street: { type: "string" },
        zip: { type: "string" },
      },
    });
  });

  it("handles an empty z.object schema without errors", () => {
    // Edge case: empty object schema should produce an empty but valid JSON Schema node
    const schema = z.object({});
    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.type).toBe("object");
    expect(result!.properties).toEqual({});
    expect(result!.required).toEqual([]);
  });

  it("skips unrecognised field types (e.g. z.array) and excludes them from output", () => {
    // Fields with unsupported types (array, union, etc.) are omitted rather than
    // emitting a broken schema fragment.
    const schema = z.object({
      name: z.string(),
      tags: z.array(z.string()), // unsupported — should be omitted
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.properties.name).toEqual({ type: "string" });
    // 'tags' is silently omitted — not undefined/null, just absent
    expect("tags" in result!.properties).toBe(false);
  });
});
