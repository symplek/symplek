import Anthropic from "@anthropic-ai/sdk";
import { WeftError } from "../errors";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
} from "./interface";

/**
 * Anthropic Provider Adapter
 */
export function createAnthropicProvider(apiKey: string): Provider {
  if (!apiKey) {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      why: "ANTHROPIC_API_KEY is not set",
      fix: {
        description: "Set the ANTHROPIC_API_KEY environment variable",
        docsUrl: "https://console.anthropic.com/settings/keys",
      },
      example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
    });
  }
  const client = new Anthropic({ apiKey });

  const capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
    maxContextTokens: 200000,
  };

  function transformMessages(messages: AIMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    const system = messages.find((m) => m.role === "system")?.content;
    const filteredMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "user")
          return { role: "user", content: m.content } as Anthropic.MessageParam;
        if (m.role === "assistant")
          return {
            role: "assistant",
            content: m.content,
          } as Anthropic.MessageParam;
        // Anthropic handles tool messages differently, but for basic chat:
        return { role: "user", content: m.content } as Anthropic.MessageParam;
      });

    return { system, messages: filteredMessages };
  }

  function transformFinishReason(
    reason: string | null | undefined,
  ): AIResponse["finishReason"] {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      case "tool_use":
        return "tool_calls";
      default:
        return "other";
    }
  }

  return {
    id: "anthropic",
    name: "Anthropic",
    capabilities,

    async generate(request: AIRequest): Promise<AIResponse> {
      try {
        const { system, messages } = transformMessages(request.messages);
        const response = await client.messages.create({
          model: request.model,
          system,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          stop_sequences: request.stop,
          top_p: request.topP,
        });

        const content = response.content[0];
        const text = content.type === "text" ? content.text : "";

        return {
          text,
          usage: {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens:
              response.usage.input_tokens + response.usage.output_tokens,
          },
          finishReason: transformFinishReason(response.stop_reason),
          raw: response,
        };
      } catch (error: any) {
        const detail = error.message?.replace(apiKey, "[REDACTED]");
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `Anthropic request failed: ${detail}`,
          fix: {
            description:
              "Verify ANTHROPIC_API_KEY is set and the model name is correct.",
            docsUrl: "https://docs.anthropic.com/en/api/getting-started",
          },
          example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
          cause: error,
        });
      }
    },

    async *stream(request: AIRequest): AsyncIterable<StreamChunk> {
      try {
        const { system, messages } = transformMessages(request.messages);
        const stream = await client.messages.stream({
          model: request.model,
          system,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          stop_sequences: request.stop,
          top_p: request.topP,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield { textDelta: event.delta.text };
          } else if (event.type === "message_delta") {
            yield {
              textDelta: "",
              finishReason: transformFinishReason(event.delta.stop_reason),
              usage: event.usage
                ? {
                    promptTokens: 0, // Delta doesn't always provide full usage
                    completionTokens: event.usage.output_tokens,
                    totalTokens: event.usage.output_tokens,
                  }
                : undefined,
            };
          } else if (event.type === "message_start") {
            // Initial usage
            yield {
              textDelta: "",
              usage: {
                promptTokens: event.message.usage.input_tokens,
                completionTokens: 0,
                totalTokens: event.message.usage.input_tokens,
              },
            };
          }
        }
      } catch (error: any) {
        const detail = error.message?.replace(apiKey, "[REDACTED]");
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `Anthropic streaming failed: ${detail}`,
          fix: {
            description:
              "Verify ANTHROPIC_API_KEY is set and streaming is supported for the requested model.",
            docsUrl: "https://docs.anthropic.com/en/api/messages-streaming",
          },
          example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
          cause: error,
        });
      }
    },

    identify() {
      return { id: "anthropic", name: "Anthropic" };
    },
  };
}
