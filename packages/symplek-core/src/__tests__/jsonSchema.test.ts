/**
 * @module jsonSchema.test
 *
 * A Zod schema has to reach the model with every field intact, whichever
 * generation of Zod built it. Zod 3 and Zod 4 schemas need different
 * converters; given the wrong one, a schema is described as "anything" and
 * nothing fails until the model's reply is rejected.
 */

import { describe, expect, it } from "vitest";
import { z as z3 } from "zod";
import { z as z4 } from "zod/v4";
import { zodSchemaToJsonSchema } from "../agent/executor";
import { toJsonSchema } from "../jsonSchema";

// The same shape built with each generation of Zod.
const shapes = {
  "Zod 3": z3.object({
    title: z3.string(),
    priority: z3.enum(["low", "high"]),
    tags: z3.array(z3.string()),
    kind: z3.literal("task"),
    estimate: z3.union([z3.number(), z3.string()]),
    owner: z3.object({ name: z3.string() }),
    note: z3.string().optional(),
    due: z3.string().nullable(),
  }),
  "Zod 4": z4.object({
    title: z4.string(),
    priority: z4.enum(["low", "high"]),
    tags: z4.array(z4.string()),
    kind: z4.literal("task"),
    estimate: z4.union([z4.number(), z4.string()]),
    owner: z4.object({ name: z4.string() }),
    note: z4.string().optional(),
    due: z4.string().nullable(),
  }),
};

type Node = Record<string, unknown>;

describe.each(Object.entries(shapes))("toJsonSchema with a %s schema", (_label, schema) => {
  const json = toJsonSchema(schema) as { type: string; properties: Record<string, Node>; required: string[] };

  it("describes an object and names every field", () => {
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties).sort()).toEqual(
      ["due", "estimate", "kind", "note", "owner", "priority", "tags", "title"],
    );
  });

  it("keeps enum values, array items, literals and nested objects", () => {
    expect(json.properties.priority.enum).toEqual(["low", "high"]);
    expect(json.properties.tags.type).toBe("array");
    expect((json.properties.tags.items as Node).type).toBe("string");
    expect(JSON.stringify(json.properties.kind)).toContain("task");
    expect((json.properties.owner.properties as Node).name).toBeDefined();
  });

  it("keeps both branches of a union", () => {
    const branches = JSON.stringify(json.properties.estimate);
    expect(branches).toContain("number");
    expect(branches).toContain("string");
  });

  it("marks only the optional field as not required", () => {
    expect(json.required).toContain("title");
    expect(json.required).toContain("due");
    expect(json.required).not.toContain("note");
  });

  it("is self-contained: no $schema marker and no $ref", () => {
    expect(json).not.toHaveProperty("$schema");
    expect(JSON.stringify(json)).not.toContain("$ref");
  });

  it("is accepted as a tool input schema, closed to extra properties", () => {
    const tool = zodSchemaToJsonSchema(schema as never);
    expect(tool?.type).toBe("object");
    expect(tool?.additionalProperties).toBe(false);
    expect(Object.keys(tool?.properties as Node)).toHaveLength(8);
  });
});

describe("zodSchemaToJsonSchema", () => {
  it("rejects a root schema that is not an object, for either generation", () => {
    expect(zodSchemaToJsonSchema(z3.string())).toBeUndefined();
    expect(zodSchemaToJsonSchema(z4.array(z4.string()) as never)).toBeUndefined();
  });
});
