import OpenAI from "openai";
import { WeftError } from "../errors";
import { redactErrorMessage, safeCause } from "./redact";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
} from "./interface";

/**
 * OpenAI Provider Adapter
 */
export function createOpenAIProvider(apiKey: string): Provider {
  if (!apiKey) {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      why: "OPENAI_API_KEY is not set",
      fix: {
        description: "Set the OPENAI_API_KEY environment variable",
        docsUrl: "https://platform.openai.com/api-keys",
      },
      example: 'process.env.OPENAI_API_KEY = "sk-proj-...";',
    });
  }
  const client = new OpenAI({ apiKey });

  const capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
    maxContextTokens: 128000, // Default for gpt-4o
  };

  function transformMessages(
    messages: AIMessage[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "system") return { role: "system", content: m.content };
      if (m.role === "user") return { role: "user", content: m.content };
      if (m.role === "assistant")
        return { role: "assistant", content: m.content };
      if (m.role === "tool") {
        return {
          role: "tool",
          content: m.content,
          tool_call_id: m.toolCallId || "",
        };
      }
      return { role: "user", content: m.content }; // Fallback
    });
  }

  function transformFinishReason(
    reason: string | null | undefined,
  ): AIResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
        return "tool_calls";
      default:
        return "other";
    }
  }

  return {
    id: "openai",
    name: "OpenAI",
    capabilities,

    async generate(request: AIRequest): Promise<AIResponse> {
      try {
        const response = await client.chat.completions.create({
          model: request.model,
          messages: transformMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          seed: request.seed,
          response_format:
            request.responseFormat?.type === "json_object"
              ? { type: "json_object" }
              : undefined,
        });

        const choice = response.choices[0];
        return {
          text: choice.message.content || "",
          usage: {
            promptTokens: response.usage?.prompt_tokens || 0,
            completionTokens: response.usage?.completion_tokens || 0,
            totalTokens: response.usage?.total_tokens || 0,
          },
          finishReason: transformFinishReason(choice.finish_reason),
          raw: response,
        };
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `OpenAI request failed: ${detail}`,
          fix: {
            description:
              "Verify OPENAI_API_KEY is set and the model name is correct.",
            docsUrl: "https://platform.openai.com/api-keys",
          },
          example: 'process.env.OPENAI_API_KEY = "sk-proj-...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    async *stream(request: AIRequest): AsyncIterable<StreamChunk> {
      try {
        const stream = await client.chat.completions.create({
          model: request.model,
          messages: transformMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stop: request.stop,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          seed: request.seed,
          response_format:
            request.responseFormat?.type === "json_object"
              ? { type: "json_object" }
              : undefined,
          stream: true,
          stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          const delta = choice?.delta?.content || "";
          const usage = chunk.usage
            ? {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              }
            : undefined;

          yield {
            textDelta: delta,
            usage,
            finishReason: choice?.finish_reason
              ? transformFinishReason(choice.finish_reason)
              : undefined,
          };
        }
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `OpenAI streaming failed: ${detail}`,
          fix: {
            description:
              "Verify OPENAI_API_KEY is set and streaming is supported for the requested model.",
            docsUrl: "https://platform.openai.com/docs/api-reference/streaming",
          },
          example: 'process.env.OPENAI_API_KEY = "sk-proj-...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    identify() {
      return { id: "openai", name: "OpenAI" };
    },
  };
}
