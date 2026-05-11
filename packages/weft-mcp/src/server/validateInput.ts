/**
 * @module validateInput - Minimal JSON-Schema-subset validator for MCP tool inputs.
 * @description Validates `tools/call` arguments against the declared `inputSchema`
 *   at the JSON-RPC boundary. We hand-roll the subset (type/properties/required/
 *   maxLength/maxItems/minimum/maximum/enum) instead of pulling in ajv to keep
 *   the published @weft/mcp surface dependency-free.
 *
 *   This is intentionally strict: any deviation from the schema is rejected with
 *   JSON-RPC -32602 (Invalid params). MCP callers get a precise error message;
 *   the server never executes a tool with untrusted-shape arguments.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 * @runtime node
 * @surface internal
 */

type JsonSchemaType = "object" | "array" | "string" | "number" | "boolean";

interface JsonSchema {
  type?: JsonSchemaType | readonly JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  items?: JsonSchema;
  maxLength?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  enum?: readonly (string | number)[];
}

/** Default size caps applied when the schema doesn't set explicit limits. */
const DEFAULT_MAX_STRING_LENGTH = 32_768;
const DEFAULT_MAX_ARRAY_LENGTH = 256;
const DEFAULT_MAX_OBJECT_DEPTH = 16;

export class ValidationError extends Error {
  /** JSON-RPC error code -32602 — invalid params. */
  readonly code = -32602 as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function jsTypeOf(value: unknown): JsonSchemaType | "null" | "undefined" {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object" || t === "string" || t === "number" || t === "boolean") {
    return t;
  }
  return "undefined";
}

function matchesType(
  value: unknown,
  expected: JsonSchemaType | readonly JsonSchemaType[],
): boolean {
  const actual = jsTypeOf(value);
  const types = Array.isArray(expected) ? expected : [expected];
  return (types as readonly JsonSchemaType[]).includes(
    actual as JsonSchemaType,
  );
}

function validateAt(
  value: unknown,
  schema: JsonSchema,
  path: string,
  depth: number,
): void {
  if (depth > DEFAULT_MAX_OBJECT_DEPTH) {
    throw new ValidationError(
      `${path}: nesting depth exceeds ${DEFAULT_MAX_OBJECT_DEPTH}`,
    );
  }

  if (schema.type && !matchesType(value, schema.type)) {
    throw new ValidationError(
      `${path}: expected ${String(schema.type)}, got ${jsTypeOf(value)}`,
    );
  }

  if (schema.enum && !schema.enum.includes(value as string | number)) {
    throw new ValidationError(
      `${path}: must be one of ${JSON.stringify(schema.enum)}`,
    );
  }

  if (typeof value === "string") {
    const max = schema.maxLength ?? DEFAULT_MAX_STRING_LENGTH;
    if (value.length > max) {
      throw new ValidationError(
        `${path}: string length ${value.length} exceeds maximum ${max}`,
      );
    }
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`${path}: must be a finite number`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new ValidationError(
        `${path}: value ${value} below minimum ${schema.minimum}`,
      );
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new ValidationError(
        `${path}: value ${value} above maximum ${schema.maximum}`,
      );
    }
  }

  if (Array.isArray(value)) {
    const max = schema.maxItems ?? DEFAULT_MAX_ARRAY_LENGTH;
    if (value.length > max) {
      throw new ValidationError(
        `${path}: array length ${value.length} exceeds maximum ${max}`,
      );
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateAt(value[i], schema.items, `${path}[${i}]`, depth + 1);
      }
    }
  }

  if (
    schema.type === "object" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          throw new ValidationError(
            `${path}: missing required property '${key}'`,
          );
        }
      }
    }

    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateAt(obj[key], sub, `${path}.${key}`, depth + 1);
        }
      }
    }
  }
}

/**
 * Validate an arbitrary value against a JSON-Schema-subset definition.
 * Throws `ValidationError` (carries JSON-RPC code -32602) on any deviation.
 */
export function validateInput(value: unknown, schema: JsonSchema): void {
  validateAt(value, schema, "$", 0);
}
