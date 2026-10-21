import type { z } from "zod";

/**
 * Type helper to infer the output type of a Zod schema.
 */
export type InferOutput<T extends z.ZodType> = z.infer<T>;

/**
 * Validates that a value matches a Zod schema.
 * @param schema The Zod schema to validate against.
 * @param value The value to validate.
 * @returns The parsed value.
 * @throws Error if validation fails.
 */
export function validateSchema<T extends z.ZodType>(
  schema: T,
  value: unknown,
): InferOutput<T> {
  return schema.parse(value);
}
