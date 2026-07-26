/**
 * @module ai-structured-wiring - the primary ai() path must actually request strict mode
 * @description CR-502 built constrained decoding, but ai() -- the path every
 *   `Symplek(task, { schema })` call flows through -- still sent the legacy
 *   `{ type: "json_object" }`. The capability existed and was unreachable, the
 *   same "built but unwired" shape the original audit named. These pin the
 *   wiring so it cannot silently regress to the legacy format.
 * @rules @.claude/rules/patterns/316-file-header-contracts.md
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ai } from "../ai";
import type {
  AIRequest,
  AIResponse,
  Provider,
  StreamChunk,
} from "../providers/interface";
import { providerRegistry } from "../providers/registry";

/** Captures the request the provider actually received. */
function makeCapturingProvider(
  id: string,
  strictStructuredOutput: boolean,
): { provider: Provider; seen: AIRequest[] } {
  const seen: AIRequest[] = [];
  const provider: Provider = {
    id,
    name: `Capture (${id})`,
    capabilities: {
      streaming: true,
      tools: false,
      vision: false,
      structuredOutput: true,
      strictStructuredOutput,
      maxContextTokens: 4096,
    },
    async generate(req: AIRequest): Promise<AIResponse> {
      seen.push(req);
      return {
        text: JSON.stringify({ verdict: "approved" }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: "stop",
      };
    },
    async *stream(_req: AIRequest): AsyncIterable<StreamChunk> {
      yield { textDelta: "x", finishReason: "stop" };
    },
    identify() {
      return { id, name: `Capture (${id})` };
    },
  };
  return { provider, seen };
}

const Schema = z.object({ verdict: z.enum(["approved", "denied"]) });

describe("ai() wires schemas into strict structured output", () => {
  beforeEach(() => {
    providerRegistry.clear?.();
  });
  afterEach(() => {
    providerRegistry.clear?.();
  });

  it("requests json_schema (not legacy json_object) when the provider supports strict", async () => {
    const { provider, seen } = makeCapturingProvider("strict-cap", true);
    providerRegistry.register(provider, true);

    await ai("decide", { schema: Schema, model: "test-model" });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.responseFormat?.type).toBe("json_schema");
  });

  it("carries the original Zod schema so validation covers the full constraint set", async () => {
    const { provider, seen } = makeCapturingProvider("strict-zod", true);
    providerRegistry.register(provider, true);

    await ai("decide", { schema: Schema, model: "test-model" });

    const format = seen[0]?.responseFormat;
    expect(format?.type).toBe("json_schema");
    if (format?.type === "json_schema") {
      // Without this, the adapter falls back to a JSON Schema subset walker
      // that silently accepts enum violations.
      expect(format.zodSchema).toBeDefined();
      expect(format.strict).toBe(true);
      expect(format.schema).toBeDefined();
    }
  });

  it("degrades to json_object when the provider cannot enforce strictly", async () => {
    const { provider, seen } = makeCapturingProvider("loose-cap", false);
    providerRegistry.register(provider, true);

    await ai("decide", { schema: Schema, model: "test-model" });

    expect(seen[0]?.responseFormat?.type).toBe("json_object");
  });

  it("sends no responseFormat at all when no schema was supplied", async () => {
    const { provider, seen } = makeCapturingProvider("no-schema", true);
    providerRegistry.register(provider, true);

    await ai("just text", { model: "test-model" });

    expect(seen[0]?.responseFormat).toBeUndefined();
  });
});
