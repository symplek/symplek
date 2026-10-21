/**
 * @module jsonSchema
 * @description The one place a Zod schema is turned into JSON Schema, for
 *   tool parameters (agent/executor.ts) and for telling a model what shape
 *   `ai(prompt, { schema })` expects (ai.ts).
 *
 *   Zod 3 and Zod 4 schemas are different objects with different internals,
 *   and both are in use: `zod@^3.25` is Zod 3 at its root, and a fresh
 *   `pnpm add zod` installs Zod 4. A converter that only understands one
 *   silently describes the other as "anything", so each is routed to the
 *   converter built for it.
 *
 * @internal Not part of the public API surface.
 */

import * as zod4 from "zod/v4";
import { zodToJsonSchema } from "zod-to-json-schema";

export type JsonSchema = Record<string, unknown>;

/** Zod 4 schemas carry a `_zod` internals object; Zod 3 schemas do not. */
function isZod4Schema(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null && "_zod" in schema;
}

/**
 * Convert a Zod schema (3 or 4) to a JSON Schema object with no `$schema`
 * marker. Zod 3 schemas are inlined in full; a recursive Zod 4 schema keeps
 * the `$ref` that expresses the recursion.
 */
export function toJsonSchema(schema: unknown): JsonSchema {
  const jsonSchema = isZod4Schema(schema)
    ? (zod4.toJSONSchema(schema as never, {
        // The input side is what a model has to produce: a field with a
        // default is optional there. A type JSON Schema cannot express
        // (a date, a bigint, a transform) becomes "any value" for that one
        // field, where the default behaviour throws and loses every field.
        io: "input",
        unrepresentable: "any",
      }) as JsonSchema)
    : // biome-ignore lint/suspicious/noExplicitAny: Zod 3's recursive generics exceed the instantiation depth of zodToJsonSchema's signature
      (zodToJsonSchema(schema as any, { $refStrategy: "none" }) as JsonSchema);
  delete jsonSchema.$schema;
  return jsonSchema;
}
