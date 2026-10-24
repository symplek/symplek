/**
 * @module streaming-parts — Typed stream-part utilities for @symplek/core
 * @description
 *   Utilities for working with the StreamPart discriminated union introduced in
 *   CR-502. Lives as a sibling to streaming.ts (not a sub-directory) to avoid
 *   the "./streaming" resolution ambiguity that would arise from a streaming/
 *   directory alongside streaming.ts.
 *
 * @rules .claude/rules/core/039-design-philosophy.md
 */

import type {
  AIUsage,
  FinishPart,
  ProviderCapabilities,
  ResponseFormat,
  StreamChunk,
  StreamPart,
  TextDeltaPart,
} from "./providers/interface";

// ─── Migration adapter ───────────────────────────────────────────────────────

/**
 * Convert an AsyncIterable<StreamPart> to an AsyncGenerator<string>.
 * Drops everything except text-delta parts. Provides a direct migration path
 * for callers that only want text and are adopting streamParts() without
 * changing their consumption pattern.
 *
 * The character sequence produced is identical to what stream() yields for the
 * same request (stream() also skips non-text events).
 *
 * @example
 * ```typescript
 * // Before: stream()-based consumer
 * for await (const chunk of provider.stream(req)) {
 *   process(chunk.textDelta);
 * }
 * // After: adopts typed parts without any behavioral change
 * for await (const text of textPartsOnly(provider.streamParts!(req))) {
 *   process(text);
 * }
 * ```
 */
export async function* textPartsOnly(
  parts: AsyncIterable<StreamPart>,
): AsyncGenerator<string> {
  for await (const part of parts) {
    if (part.type === "text-delta" && part.textDelta) {
      yield part.textDelta;
    }
  }
}

/**
 * Fallback adapter: wraps a legacy AsyncIterable<StreamChunk> (from stream())
 * as an AsyncIterable<StreamPart>. Used for providers that have not yet
 * implemented the optional streamParts() method.
 *
 * Emits TextDeltaPart per chunk (skipping empty textDelta), and a FinishPart
 * when a chunk carries a finishReason. Callers should prefer
 * provider.streamParts() when available.
 */
export async function* streamPartsFromChunks(
  chunks: AsyncIterable<StreamChunk>,
): AsyncIterable<StreamPart> {
  let lastUsage: AIUsage | undefined;
  let lastFinishReason: FinishPart["finishReason"] | undefined;

  for await (const chunk of chunks) {
    if (chunk.usage) lastUsage = chunk.usage;
    if (chunk.finishReason) lastFinishReason = chunk.finishReason;
    if (chunk.textDelta) {
      const part: TextDeltaPart = { type: "text-delta", textDelta: chunk.textDelta };
      if (chunk.usage) part.usage = chunk.usage;
      yield part;
    }
  }

  if (lastFinishReason) {
    yield {
      type: "finish",
      finishReason: lastFinishReason,
      usage: lastUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } satisfies FinishPart;
  }
}

// ─── Schema validation ───────────────────────────────────────────────────────

/**
 * Known provider-specific schema constraints. Checked at construction time so
 * a schema violation throws before any API call is made.
 *
 * Constraints:
 * - OpenAI strict mode: no `$ref`, no `additionalProperties: true`
 * - Google responseSchema: `nullable` not supported
 * - Anthropic tool_use forcing: requires `name` field (passed via ResponseFormat.name)
 */
export function validateSchemaForProvider(
  schema: Record<string, unknown>,
  capabilities: ProviderCapabilities,
): void {
  if (!capabilities.strictStructuredOutput) return; // no constraints to enforce

  // Flatten and walk the schema for disallowed patterns. Only $ref and
  // additionalProperties:true matter for OpenAI strict mode. Anthropic's
  // tool_use approach does not have the same constraints.
  const issues = collectSchemaIssues(schema);
  if (issues.length > 0) {
    throw new Error(
      `JSON schema contains unsupported constructs for strict structured output: ${issues.join("; ")}. ` +
        "Remove $ref usage and ensure additionalProperties is not set to true.",
    );
  }
}

function collectSchemaIssues(
  node: Record<string, unknown>,
  path = "$",
): string[] {
  const issues: string[] = [];

  if ("$ref" in node) {
    issues.push(`$ref at ${path} (not allowed in OpenAI strict mode)`);
  }
  if (node.additionalProperties === true) {
    issues.push(`additionalProperties:true at ${path} (not allowed in OpenAI strict mode)`);
  }

  // Recurse into properties
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        issues.push(...collectSchemaIssues(val as Record<string, unknown>, `${path}.${key}`));
      }
    }
  }

  // Recurse into items (arrays)
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    issues.push(...collectSchemaIssues(node.items as Record<string, unknown>, `${path}[]`));
  }

  return issues;
}

// ─── Format resolution ───────────────────────────────────────────────────────

/**
 * Resolve the effective response format for a provider, accounting for
 * capability gaps. Returns the format that will actually be sent plus a
 * flag indicating whether the guarantee degraded.
 *
 * Callers MUST check `degraded` when strict output is required: if true, the
 * provider will return json_object mode and post-hoc validation is the caller's
 * responsibility.
 *
 * @example
 * ```typescript
 * const { format, degraded } = resolveResponseFormat(request.responseFormat, provider.capabilities);
 * if (degraded) {
 *   // provider cannot enforce the schema — validate the response yourself
 * }
 * ```
 */
export function resolveResponseFormat(
  format: ResponseFormat | undefined,
  capabilities: ProviderCapabilities,
): { format: ResponseFormat | undefined; degraded: boolean } {
  if (!format || format.type !== "json_schema") {
    return { format, degraded: false };
  }
  if (format.strict && !capabilities.strictStructuredOutput) {
    // Provider cannot enforce schema at generation time — degrade to json_object
    return { format: { type: "json_object" }, degraded: true };
  }
  return { format, degraded: false };
}
