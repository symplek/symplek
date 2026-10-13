/**
 * The one place the CLI knows about model ids.
 *
 * Providers add and retire models far more often than this CLI is released,
 * so the CLI does not decide which models exist. Any well-formed id passes
 * `validate` and `generate`; the provider is the authority on whether it is
 * live. The list below is only what `symplek add agent` offers in its picker.
 */

/** Offered by the interactive picker. Mirrors @symplek/core's default model table. */
export const SUGGESTED_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
] as const;

/** Used when the caller names no model. */
export const DEFAULT_MODEL: string = SUGGESTED_MODELS[0];

/**
 * The shape of a model id: letters, digits, and `. _ : / -`, starting with a
 * letter or digit. Wide enough for dated snapshots, fine-tune ids and
 * `vendor/model` routes; narrow enough that an id can be written into YAML or
 * TypeScript without quoting hazards (no whitespace, quotes or newlines).
 */
export const MODEL_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$";

const MODEL_ID_REGEX = new RegExp(MODEL_ID_PATTERN);

/** True when `value` is a well-formed model id. */
export function isModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_ID_REGEX.test(value);
}

/** One-line hint shown when a model id is missing or malformed. */
export const MODEL_ID_HINT = `Use a provider model id, for example: ${SUGGESTED_MODELS.join(", ")}`;
