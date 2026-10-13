/**
 * @module anthropic-adapter.test
 *
 * The Anthropic adapter against the response shape current Claude models
 * return: a list of content blocks in which thinking comes before the answer.
 * The SDK client is replaced with a recorder; the adapter under test is real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create };
  },
}));

function reply(content: unknown[], stop_reason = "end_turn") {
  return {
    content,
    stop_reason,
    usage: { input_tokens: 3, output_tokens: 5 },
  };
}

async function adapter() {
  const { createAnthropicProvider } = await import("../providers/anthropic");
  return createAnthropicProvider("sk-ant-test");
}

beforeEach(() => {
  create.mockReset();
});

describe("Anthropic adapter", () => {
  it("returns the answer when a thinking block comes first", async () => {
    create.mockResolvedValue(
      reply([
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Paris" },
      ]),
    );
    const provider = await adapter();

    const response = await provider.generate({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "Capital of France?" }],
    });
    expect(response.text).toBe("Paris");
  });

  it("joins every text block, in order", async () => {
    create.mockResolvedValue(
      reply([
        { type: "text", text: "First. " },
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Second." },
      ]),
    );
    const provider = await adapter();

    const response = await provider.generate({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "Two parts" }],
    });
    expect(response.text).toBe("First. Second.");
  });

  it("leaves room for thinking when the caller sets no output cap", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    const provider = await adapter();

    await provider.generate({
      model: "claude-haiku-5-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(create.mock.calls[0][0].max_tokens).toBe(16000);

    await provider.generate({
      model: "claude-haiku-5-5",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 256,
    });
    expect(create.mock.calls[1][0].max_tokens).toBe(256);
  });

  it("reports a refusal as a content filter stop, not as a normal finish", async () => {
    create.mockResolvedValue(reply([], "refusal"));
    const provider = await adapter();

    const response = await provider.generate({
      model: "claude-opus-5-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.finishReason).toBe("content_filter");
    expect(response.text).toBe("");
  });

  it("does not forward sampling parameters, which current Claude models reject", async () => {
    create.mockResolvedValue(reply([{ type: "text", text: "ok" }]));
    const provider = await adapter();

    await provider.generate({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      topP: 0.9,
    });
    const request = create.mock.calls[0][0];
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
  });
});
