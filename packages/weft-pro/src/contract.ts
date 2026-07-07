/**
 * @fileoverview Contract validation types and utilities for AgentUnit
 * @description Enables compile-time and runtime validation of data contracts
 * @module weft-core/contract
 * @since 1.0.0-beta.2
 *
 * 📝 BUILD[F-047]: Contract-based data validation for AgentUnit composition
 *
 * @remarks
 * Contract validation makes data shape expectations explicit:
 * - Producers declare what they `.provides()` via Zod schema
 * - Consumers declare what they `.expects()` via Zod schema
 * - Mismatches fail at the boundary with actionable error messages
 *
 * @example
 * ```typescript
 * // Define shared contract
 * const TemplateContract = z.object({
 *   templateId: z.string(),
 *   tasks: z.array(TaskSchema),
 * });
 *
 * // Producer validates output
 * const producer = AgentUnit.from(orchestrate)
 *   .provides(TemplateContract);
 *
 * // Consumer validates input
 * const consumer = AgentUnit.from(synthesize)
 *   .expects(TemplateContract, ctx => ctx.extensions?.template);
 * ```
 */

// License gate — FATAL #6 HARDENING (2026-07-07)
import "./license-gate";

import type { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for contract validation.
 */
export interface ContractOptions {
  /**
   * If true, fail on fields not in schema (default: false).
   * Catches schema drift where producer adds fields consumer doesn't expect.
   *
   * @example
   * ```typescript
   * // Strict mode catches extra fields
   * AgentUnit.of({ name: 'test', extra: true })
   *   .provides(z.object({ name: z.string() }), { strict: true })
   *   // Throws: ContractError - extra field 'extra' not in schema
   * ```
   */
  strict?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT MISMATCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single mismatch between expected and actual data shape.
 *
 * @remarks
 * Provides path-aware error information for debugging.
 * The path uses dot notation (e.g., "metadata.typicalDurationWeeks.min").
 */
export interface ContractMismatch {
  /**
   * Dot-notation path to the invalid field.
   * Empty string or "(root)" for root-level errors.
   *
   * @example
   * "metadata.typicalDurationWeeks" // Nested field
   * "tasks.0.name"                   // Array element field
   * "(root)"                         // Root-level error
   */
  path: string;

  /**
   * Expected type or value description.
   *
   * @example
   * "string"   // Expected a string
   * "number"   // Expected a number
   * "object"   // Expected an object
   */
  expected: string;

  /**
   * Actual type or value received.
   *
   * @example
   * "undefined" // Got undefined
   * "number"    // Got number when expecting string
   */
  received: string;

  /**
   * Human-readable error message from Zod.
   *
   * @example
   * "Required"
   * "Expected string, received number"
   */
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT ERROR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when contract validation fails.
 *
 * @remarks
 * ContractError provides:
 * - Clear identification of producer and consumer
 * - All validation mismatches (not just the first)
 * - Path-aware error messages for easy debugging
 * - Standard Error inheritance for stack traces
 *
 * @example
 * ```typescript
 * try {
 *   await unit.run(ctx);
 * } catch (e) {
 *   if (e instanceof ContractError) {
 *     console.log(e.producerName);  // "orchestrator"
 *     console.log(e.consumerName);  // "output"
 *     console.log(e.mismatches);    // [{ path: "metadata", ... }]
 *   }
 * }
 * ```
 */
export class ContractError extends Error {
  /**
   * Error name for instanceof checks and logging.
   */
  public readonly name = "ContractError";

  /**
   * Create a new ContractError.
   *
   * @param producerName - Name/ID of the producing unit
   * @param consumerName - Name/ID of the consuming unit (or 'output' for .provides())
   * @param mismatches - All validation mismatches
   */
  constructor(
    /** Name/ID of the producing unit */
    public readonly producerName: string,
    /** Name/ID of the consuming unit (or 'output' for .provides()) */
    public readonly consumerName: string,
    /** All validation mismatches */
    public readonly mismatches: ContractMismatch[],
  ) {
    const details = mismatches
      .map((m) => `  - ${m.path}: ${m.message}`)
      .join("\n");
    super(
      `Contract mismatch: ${producerName} → ${consumerName}\n` +
        `${mismatches.length} validation error(s):\n${details}`,
    );

    // Maintain proper stack trace in V8 (Node/Chrome)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ContractError);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOD ERROR CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Zod validation errors to ContractMismatch array.
 *
 * @param error - Zod error from safeParse()
 * @returns Array of ContractMismatch with path-aware information
 *
 * @remarks
 * Handles all Zod issue types including:
 * - invalid_type (most common)
 * - unrecognized_keys (for strict mode)
 * - custom errors
 *
 * @example
 * ```typescript
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   const mismatches = zodErrorToMismatches(result.error);
 *   throw new ContractError('producer', 'consumer', mismatches);
 * }
 * ```
 */
export function zodErrorToMismatches(error: z.ZodError): ContractMismatch[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    expected:
      issue.code === "invalid_type"
        ? (issue as z.ZodInvalidTypeIssue).expected
        : issue.code === "unrecognized_keys"
          ? "no extra keys"
          : "valid",
    received:
      issue.code === "invalid_type"
        ? (issue as z.ZodInvalidTypeIssue).received
        : issue.code === "unrecognized_keys"
          ? `extra keys: ${(issue as z.ZodUnrecognizedKeysIssue).keys.join(", ")}`
          : "invalid",
    message: issue.message,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT DEFINITION HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper to define a named contract for reuse across modules.
 *
 * @param name - Human-readable contract name for error messages
 * @param schema - Zod schema defining the contract shape
 * @returns Named contract object with schema
 *
 * @remarks
 * Use this to define shared contracts that both producer and consumer reference:
 *
 * @example
 * ```typescript
 * // contracts/gantt.ts
 * export const TemplateContract = defineContract('Template',
 *   z.object({
 *     templateId: z.string(),
 *     tasks: z.array(TaskSchema),
 *     metadata: MetadataSchema,
 *   })
 * );
 *
 * // orchestrator.ts
 * import { TemplateContract } from './contracts/gantt';
 * const unit = AgentUnit.from(orchestrate)
 *   .provides(TemplateContract.schema);
 *
 * // synthesis.ts
 * import { TemplateContract } from './contracts/gantt';
 * const unit = AgentUnit.from(synthesize)
 *   .expects(TemplateContract.schema, ctx => ctx.extensions?.template);
 * ```
 */
export function defineContract<T extends z.ZodType>(
  name: string,
  schema: T,
): { name: string; schema: T } {
  return { name, schema };
}
