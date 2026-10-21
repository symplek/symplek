// Type-only import — erased at runtime; safe for lazy SDK loading.
import type OpenAI from "openai";
import { SymplekError } from "../errors";
import { redactErrorMessage, safeCause } from "./redact";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  FinishPart,
  Provider,
  ProviderCapabilities,
  ResponseFormat,
  StreamChunk,
  StreamPart,
  ToolCall,
  ToolCallPart,
  ToolDefinition,
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

// ── Exported helpers (tested directly in openai-tool-loop.test.ts) ──────────

/**
 * Convert Symplek ToolDefinition[] to the OpenAI function-tools format.
 * Returns undefined when the tools array is absent or empty so callers can
 * omit the `tools` field from the request body entirely (OpenAI rejects an
 * explicit empty `tools: []` in some model versions).
 *
 * Exported for direct unit testing — must stay in sync with the generate/stream
 * request bodies below.
 */
export function buildOpenAITools(
  tools: ToolDefinition[] | undefined,
):
  | Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>
  | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

/**
 * Parse OpenAI's tool_calls array into Symplek's ToolCall[] shape.
 * Returns undefined when there are no tool calls so AIResponse.toolCalls is
 * only populated when the model actually requested tool execution.
 *
 * Exported for direct unit testing — must stay in sync with the generate path
 * below.
 */
export function parseOpenAIToolCalls(
  toolCalls:
    | Array<{
        id: string;
        function: { name: string; arguments: string };
      }>
    | null
    | undefined,
): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: (() => {
      try {
        return JSON.parse(tc.function.arguments || "{}");
      } catch {
        return tc.function.arguments;
      }
    })(),
  }));
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
    // OpenAI natively supports json_schema with strict:true via response_format.
    strictStructuredOutput: true,
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

  /**
   * Translate ResponseFormat to OpenAI's response_format parameter.
   * json_schema is passed directly; strict controls whether OpenAI enforces
   * the schema at generation time. No $ref is allowed in strict mode.
   */
  function buildOpenAIResponseFormat(
    format: ResponseFormat | undefined,
  ): OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] | undefined {
    if (!format || format.type === "text") return undefined;
    if (format.type === "json_object") return { type: "json_object" };
    // json_schema: pass name + schema; strict defaults to true when present
    return {
      type: "json_schema",
      json_schema: {
        name: format.name,
        schema: format.schema,
        strict: format.strict ?? true,
      },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
  }

  return {
    id: "openai",
    name: "OpenAI",
    capabilities,

    async generate(request: AIRequest): Promise<AIResponse> {
      try {
        const openAITools = buildOpenAITools(request.tools);
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
          response_format: buildOpenAIResponseFormat(request.responseFormat),
          ...(openAITools ? { tools: openAITools } : {}),
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
          toolCalls: parseOpenAIToolCalls(choice.message.tool_calls as Parameters<typeof parseOpenAIToolCalls>[0]),
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
        const openAIStreamTools = buildOpenAITools(request.tools);
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
            response_format: buildOpenAIResponseFormat(request.responseFormat),
            stream: true,
            stream_options: { include_usage: true },
            ...(openAIStreamTools ? { tools: openAIStreamTools } : {}),
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

    async *streamParts(request: AIRequest): AsyncIterable<StreamPart> {
      try {
        const openAIPartsTools = buildOpenAITools(request.tools);
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
            response_format: buildOpenAIResponseFormat(request.responseFormat),
            stream: true,
            stream_options: { include_usage: true },
            ...(openAIPartsTools ? { tools: openAIPartsTools } : {}),
          },
          request.signal ? { signal: request.signal } : undefined,
        );

        // Buffer for accumulating incremental tool_calls deltas
        const toolBuffers = new Map<number, { id: string; name: string; argsJson: string }>();

        // N301 fix: OpenAI commonly sends finish_reason on the choice chunk and
        // usage on a subsequent chunk whose choices array is empty. Buffer both
        // independently and emit FinishPart as soon as both are known.
        let pendingFinishReason: string | null = null;
        let pendingUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;

        for await (const chunk of stream) {
          if (request.signal?.aborted) return; // abort: no FinishPart

          const choice = chunk.choices[0];
          const delta = choice?.delta;

          // Text content
          if (delta?.content) {
            yield { type: "text-delta", textDelta: delta.content };
          }

          // Tool call deltas — accumulate until complete
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              const buf = toolBuffers.get(idx);
              if (!buf) {
                toolBuffers.set(idx, {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  argsJson: tc.function?.arguments ?? "",
                });
              } else {
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.argsJson += tc.function.arguments;
              }
            }
          }

          // Capture finish reason; flush tool calls immediately so they precede FinishPart
          if (choice?.finish_reason) {
            pendingFinishReason = choice.finish_reason;
            if (pendingFinishReason === "tool_calls") {
              for (const buf of toolBuffers.values()) {
                let input: unknown;
                try { input = JSON.parse(buf.argsJson || "{}"); } catch { input = buf.argsJson; }
                yield {
                  type: "tool-call",
                  toolCallId: buf.id,
                  toolName: buf.name,
                  input,
                } satisfies ToolCallPart;
              }
              toolBuffers.clear();
            }
          }

          // Capture usage (may arrive in a different chunk than finish_reason)
          if (chunk.usage) {
            pendingUsage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            };
          }

          // Emit FinishPart as soon as both finish reason and usage are available
          if (pendingFinishReason !== null && pendingUsage !== null) {
            yield {
              type: "finish",
              finishReason: transformFinishReason(pendingFinishReason),
              usage: pendingUsage,
            } satisfies FinishPart;
            pendingFinishReason = null;
            pendingUsage = null;
          }
        }

        // Failsafe: emit FinishPart when finish_reason arrived but usage never did.
        // Prevents consumers from waiting forever on non-standard provider behaviour.
        if (pendingFinishReason !== null) {
          yield {
            type: "finish",
            finishReason: transformFinishReason(pendingFinishReason),
            usage: pendingUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          } satisfies FinishPart;
        }
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new SymplekError({
          code: "PROVIDER_ERROR",
          why: `OpenAI streamParts failed: ${detail}`,
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
