/**
 * @module ai-schema-instruction.test
 *
 * `ai(prompt, { schema })` validates the reply against the schema, so the
 * model has to be shown that schema. These tests read the request the
 * provider actually receives. The provider is an in-memory recorder; ai(),
 * the registry and the schema handling are real.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { ai } from "../ai";
import { _resetForTesting } from "../facade";
import type { AIRequest, Provider } from "../providers/interface";
import { providerRegistry } from "../providers/registry";

let seen: AIRequest[] = [];
let nextReply = "{}";

const recorder = {
  id: "openai",
  name: "recorder",
  capabilities: {
    streaming: false,
    tools: false,
    vision: false,
    structuredOutput: true,
    maxContextTokens: 4096,
  },
  async generate(request: AIRequest) {
    seen.push(request);
    return {
      text: nextReply,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: "stop" as const,
    };
  },
  async *stream() {
    yield { textDelta: "" };
  },
} as unknown as Provider;

const Review = z.object({
  sentiment: z.enum(["positive", "negative"]),
  tags: z.array(z.string()),
  score: z.number().optional(),
});

beforeEach(() => {
  _resetForTesting();
  providerRegistry.clear();
  providerRegistry.register(recorder, true);
  seen = [];
  nextReply = "{}";
});

afterEach(() => {
  providerRegistry.clear();
  _resetForTesting();
});

function systemPrompts(request: AIRequest): string[] {
  return request.messages
    .filter((m) => m.role === "system")
    .map((m) => String(m.content));
}

describe("ai() with a schema", () => {
  it("shows the model every field, enum value and array the reply is validated against", async () => {
    nextReply = JSON.stringify({ sentiment: "positive", tags: ["fast"] });

    const result = await ai("Classify: great and fast", { schema: Review });
    expect(result).toEqual({ sentiment: "positive", tags: ["fast"] });

    const [system] = systemPrompts(seen[0]);
    expect(system).toMatch(/JSON/);
    for (const part of ["sentiment", "positive", "negative", "tags", "array", "score"]) {
      expect(system).toContain(part);
    }
  });

  it("sends one system message that keeps the caller's own instructions", async () => {
    nextReply = JSON.stringify({ sentiment: "negative", tags: [] });

    await ai("Classify: slow", {
      schema: Review,
      system: "You grade hotel reviews.",
    });

    const system = systemPrompts(seen[0]);
    expect(system).toHaveLength(1);
    expect(system[0]).toContain("You grade hotel reviews.");
    expect(system[0]).toContain("sentiment");
  });

  it("still rejects a reply that does not match the schema", async () => {
    nextReply = JSON.stringify({ sentiment: "mixed", tags: [] });

    await expect(ai("Classify: fine", { schema: Review })).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });
  });
});

describe("ai() without a schema", () => {
  it("adds no system message of its own", async () => {
    nextReply = "plain text";

    expect(await ai("hello")).toBe("plain text");
    expect(systemPrompts(seen[0])).toEqual([]);
  });
});

describe("ai() with a Zod 4 schema holding a field JSON Schema cannot express", () => {
  it("still shows the model every other field", async () => {
    const Event = z4.object({
      title: z4.string(),
      when: z4.date(),
      seats: z4.number().default(10),
    });
    nextReply = "not json";

    await expect(ai("Describe the event", { schema: Event as never })).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });

    const [system] = systemPrompts(seen[0]);
    expect(system).toContain("title");
    expect(system).toContain("seats");
    // A field with a default is optional for the model to supply.
    expect(system).not.toMatch(/"required":\[[^\]]*"seats"/);
  });
});

describe("ai() when the provider did not answer", () => {
  const recordingGenerate = recorder.generate;
  afterEach(() => {
    recorder.generate = recordingGenerate;
  });

  it("throws on a refusal instead of returning an empty string", async () => {
    recorder.generate = async () => ({
      text: "",
      usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      finishReason: "content_filter" as const,
    });

    await expect(ai("hello")).rejects.toThrow(/declined to answer/);
  });

  it("throws when the output cap was spent before any answer text", async () => {
    recorder.generate = async () => ({
      text: "",
      usage: { promptTokens: 1, completionTokens: 9, totalTokens: 10 },
      finishReason: "length" as const,
    });

    await expect(ai("hello")).rejects.toThrow(/output limit before writing any answer/);
  });

  it("returns a reply that was cut off after some text was written", async () => {
    recorder.generate = async () => ({
      text: "partial answer",
      usage: { promptTokens: 1, completionTokens: 9, totalTokens: 10 },
      finishReason: "length" as const,
    });

    expect(await ai("hello")).toBe("partial answer");
  });
});
