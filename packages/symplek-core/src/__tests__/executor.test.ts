/**
 * @module executor.test - Unit tests for zodSchemaToJsonSchema() in executor.ts
 * @description Verifies that the full Zod type surface (arrays, enums, unions,
 *   nested objects, optional fields) is correctly serialised to JSON Schema via
 *   zod-to-json-schema (B2 fix).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodSchemaToJsonSchema } from "../agent/executor";

describe("zodSchemaToJsonSchema — full Zod type surface via zod-to-json-schema (B2)", () => {
  it("converts a simple z.object with string and number fields", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.type).toBe("object");
    const props = result!.properties as Record<string, { type: string }>;
    expect(props.name.type).toBe("string");
    expect(props.age.type).toBe("number");
    const req = result!.required as string[];
    expect(req).toContain("name");
    expect(req).toContain("age");
  });

  it("marks optional fields as not required", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.number().optional(),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const req = result!.required as string[];
    expect(req).toContain("required");
    expect(req).not.toContain("optional");
    const props = result!.properties as Record<string, unknown>;
    expect(props.optional).toBeDefined();
  });

  it("handles boolean fields", () => {
    const schema = z.object({ active: z.boolean() });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const props = result!.properties as Record<string, { type: string }>;
    expect(props.active.type).toBe("boolean");
  });

  it("returns undefined for non-object root types (e.g. z.string())", () => {
    const result = zodSchemaToJsonSchema(z.string());
    expect(result).toBeUndefined();
  });

  it("returns undefined for z.array() root (unsupported top-level type)", () => {
    const result = zodSchemaToJsonSchema(z.array(z.string()));
    expect(result).toBeUndefined();
  });

  it("produces a valid JSON-schema-shaped object with additionalProperties: false", () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().optional(),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toMatchObject({
      type: "object",
      properties: expect.any(Object),
      required: expect.any(Array),
      additionalProperties: false,
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
    const props = result!.properties as Record<string, { type: string; properties: Record<string, { type: string }> }>;
    expect(props.address.type).toBe("object");
    expect(props.address.properties.street.type).toBe("string");
    expect(props.address.properties.zip.type).toBe("string");
  });

  it("handles an empty z.object schema without errors", () => {
    const schema = z.object({});
    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    expect(result!.type).toBe("object");
    expect(result!.properties).toEqual({});
  });

  // B2 fix: previously array fields were silently dropped; now they are preserved.
  it("B2: array fields are included in the schema, not silently dropped", () => {
    const schema = z.object({
      name: z.string(),
      tags: z.array(z.string()),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const props = result!.properties as Record<string, { type: string }>;
    expect(props.name.type).toBe("string");
    // tags is an array field and must be present — not silently omitted
    expect(props.tags).toBeDefined();
    expect(props.tags.type).toBe("array");
  });

  // B2 fix: enum fields must not be dropped.
  it("B2: enum fields are included in the schema", () => {
    const schema = z.object({
      status: z.enum(["active", "inactive", "pending"]),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const props = result!.properties as Record<string, { enum?: string[] }>;
    expect(props.status).toBeDefined();
    expect(Array.isArray(props.status.enum)).toBe(true);
    expect(props.status.enum).toContain("active");
  });

  // B2 fix: union fields must not be dropped.
  it("B2: union (z.union) fields are included in the schema", () => {
    const schema = z.object({
      value: z.union([z.string(), z.number()]),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const props = result!.properties as Record<string, { anyOf?: unknown[] }>;
    expect(props.value).toBeDefined();
  });

  // B2 fix: literal fields must not be dropped.
  it("B2: literal fields are included in the schema", () => {
    const schema = z.object({
      kind: z.literal("tool_call"),
    });

    const result = zodSchemaToJsonSchema(schema);

    expect(result).toBeDefined();
    const props = result!.properties as Record<string, { const?: unknown }>;
    expect(props.kind).toBeDefined();
    expect(props.kind.const).toBe("tool_call");
  });
});
