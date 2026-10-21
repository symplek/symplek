import type {
  PatchOp,
  PatchSet,
  ValidationError,
  ValidationResult,
} from "./types";

export type PayloadValidator = (op: PatchOp) => ValidationResult<PatchOp>;

export class PayloadValidatorRegistry {
  private readonly validators = new Map<string, PayloadValidator>();

  register(kind: string, validator: PayloadValidator): void {
    this.validators.set(kind, validator);
  }

  has(kind: string): boolean {
    return this.validators.has(kind);
  }

  validate(op: PatchOp): ValidationError[] {
    const validator = this.validators.get(op.kind);
    if (!validator) {
      return [];
    }
    const result = validator(op);
    return result.ok ? [] : result.errors;
  }
}

export const payloadValidators = new PayloadValidatorRegistry();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeError(path: string, message: string): ValidationError {
  return { path, message };
}

function validateOp(op: PatchOp, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!op || typeof op !== "object") {
    return [normalizeError(`ops[${index}]`, "operation must be an object")];
  }

  if (typeof op.opId !== "string" || op.opId.trim().length === 0) {
    errors.push(normalizeError(`ops[${index}].opId`, "opId must be non-empty"));
  }

  if (typeof op.kind !== "string" || op.kind.trim().length === 0) {
    errors.push(normalizeError(`ops[${index}].kind`, "kind must be non-empty"));
  }

  if (typeof op.targetId !== "string" || op.targetId.trim().length === 0) {
    errors.push(
      normalizeError(`ops[${index}].targetId`, "targetId must be non-empty"),
    );
  }

  if ("payload" in op) {
    if (typeof op.payload === "number" && !Number.isFinite(op.payload)) {
      errors.push(
        normalizeError(
          `ops[${index}].payload`,
          "payload cannot be NaN or Infinity",
        ),
      );
    }
  }

  errors.push(...payloadValidators.validate(op));
  return errors;
}

export function validatePatchSet(
  input: unknown,
): ValidationResult<PatchSet<PatchOp>> {
  const errors: ValidationError[] = [];
  const patchSet = input as PatchSet<PatchOp>;

  if (!patchSet || typeof patchSet !== "object") {
    return {
      ok: false,
      errors: [normalizeError("patchSet", "patchSet must be an object")],
    };
  }

  if (
    typeof patchSet.patchSetId !== "string" ||
    patchSet.patchSetId.trim() === ""
  ) {
    errors.push(normalizeError("patchSetId", "patchSetId must be non-empty"));
  }

  if (typeof patchSet.baseRef !== "string" || patchSet.baseRef.trim() === "") {
    errors.push(normalizeError("baseRef", "baseRef must be non-empty"));
  }

  if (!["agent", "user"].includes(patchSet.authorType)) {
    errors.push(
      normalizeError("authorType", "authorType must be 'agent' or 'user'"),
    );
  }

  if (!["P0", "P1", "P2"].includes(patchSet.riskTier)) {
    errors.push(normalizeError("riskTier", "riskTier must be P0, P1, or P2"));
  }

  if (
    !isFiniteNumber(patchSet.confidence) ||
    patchSet.confidence < 0 ||
    patchSet.confidence > 1
  ) {
    errors.push(
      normalizeError("confidence", "confidence must be between 0 and 1"),
    );
  }

  if (!Number.isInteger(patchSet.createdAt) || patchSet.createdAt <= 0) {
    errors.push(
      normalizeError("createdAt", "createdAt must be a positive integer"),
    );
  }

  if (!Array.isArray(patchSet.consultationTrace)) {
    errors.push(
      normalizeError("consultationTrace", "consultationTrace must be an array"),
    );
  }

  if (!Array.isArray(patchSet.ops)) {
    errors.push(normalizeError("ops", "ops must be an array"));
  } else if (patchSet.ops.length === 0) {
    errors.push(
      normalizeError("ops", "ops must contain at least one operation"),
    );
  } else {
    patchSet.ops.forEach((op, index) => {
      errors.push(...validateOp(op, index));
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: patchSet };
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }

  if (value && typeof value === "object") {
    const sortedEntries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableSortValue(v)]);
    return Object.fromEntries(sortedEntries);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("cannot serialize NaN or Infinity");
  }

  return value;
}

export function serializePatchSet(ps: PatchSet<PatchOp>): string {
  const validated = validatePatchSet(ps);
  if (!validated.ok) {
    throw new Error(
      `cannot serialize invalid patch set: ${validated.errors
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ")}`,
    );
  }

  return JSON.stringify(stableSortValue(ps));
}

export function deserializePatchSet(
  json: string,
): ValidationResult<PatchSet<PatchOp>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      errors: [
        normalizeError(
          "json",
          `invalid JSON: ${error instanceof Error ? error.message : "parse error"}`,
        ),
      ],
    };
  }

  return validatePatchSet(parsed);
}
