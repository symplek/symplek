// Type-only import — erased at runtime; safe for lazy SDK loading.
import type OpenAI from "openai";
import { SymplekError } from "../errors";
import { redactErrorMessage, safeCause } from "./redact";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
} from "./interface";

// ── Lazy SDK loader ──────────────────────────────────────────────────────────
// No top-level import of openai. The SDK is loaded on first factory call and
// cached for the process lifetime — import() is called exactly once.

let _OpenAISdk: typeof import("openai")["default"] | null = null;

async function loadOpenAISdk(): Promise<typeof import("openai")["default"]> {
  if (_OpenAISdk !== null) return _OpenAISdk;
  try {
    const mod = await import("openai");
    _OpenAISdk = mod.default;
    return _OpenAISdk;
  } catch {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      why: "openai is not installed. Run: pnpm add openai",
      fix: {
        description: "Run: pnpm add openai",
        docsUrl: "https://platform.openai.com/docs/libraries",
      },
      example: "pnpm add openai",
    });
  }
}

/**
 * OpenAI Provider Adapter
 */
export async function createOpenAIProvider(
  apiKey: string,
): Promise<Provider> {
  if (!apiKey) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      why: "OPENAI_API_KEY is not set",
      fix: {
        description: "Set the OPENAI_API_KEY environment variable",
        docsUrl: "https://platform.openai.com/api-keys",
      },
      example: 'process.env.OPENAI_API_KEY = "sk-proj-...";',
    });
  }
  const OpenAI = await loadOpenAISdk();
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
        throw new SymplekError({
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
        // N61 fix: pass signal as the second options argument so the OpenAI SDK
        // can abort the in-flight HTTP request rather than only stopping
        // iteration between chunks.
        const stream = await client.chat.completions.create(
          {
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
          },
          request.signal ? { signal: request.signal } : undefined,
        );

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
        throw new SymplekError({
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
