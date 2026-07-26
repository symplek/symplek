// Type-only import — erased at runtime; safe for lazy SDK loading.
import type Anthropic from "@anthropic-ai/sdk";
import { SymplekError } from "../errors";
import { redactErrorMessage, safeCause } from "./redact";
import type {
  AIMessage,
  AIRequest,
  AIResponse,
  Provider,
  ProviderCapabilities,
  StreamChunk,
  ToolCall,
} from "./interface";

// ── Lazy SDK loader ──────────────────────────────────────────────────────────
// No top-level import of @anthropic-ai/sdk. The SDK is loaded on first factory
// call and cached for the process lifetime — import() is called exactly once.

let _AnthropicSdk: typeof import("@anthropic-ai/sdk")["default"] | null = null;

async function loadAnthropicSdk(): Promise<
  typeof import("@anthropic-ai/sdk")["default"]
> {
  if (_AnthropicSdk !== null) return _AnthropicSdk;
  try {
    const mod = await import("@anthropic-ai/sdk");
    _AnthropicSdk = mod.default;
    return _AnthropicSdk;
  } catch {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      why: "@anthropic-ai/sdk is not installed. Run: pnpm add @anthropic-ai/sdk",
      fix: {
        description: "Run: pnpm add @anthropic-ai/sdk",
        docsUrl: "https://docs.anthropic.com/en/api/getting-started",
      },
      example: "pnpm add @anthropic-ai/sdk",
    });
  }
}

/**
 * Output cap used when the caller sets none. Anthropic requires the field.
 * On current Claude models thinking tokens count toward it, so a small cap can
 * be spent before any answer text is written.
 */
const DEFAULT_MAX_TOKENS = 16000;

/**
 * Anthropic Provider Adapter
 *
 * `temperature` and `topP` are not forwarded. Current Claude models reject
 * sampling parameters with a 400 (Opus outright, Sonnet and Haiku for any
 * non-default value), so a request that carried them failed before it ran.
 */
export async function createAnthropicProvider(
  apiKey: string,
): Promise<Provider> {
  if (!apiKey) {
    throw new SymplekError({
      code: "PROVIDER_ERROR",
      why: "ANTHROPIC_API_KEY is not set",
      fix: {
        description: "Set the ANTHROPIC_API_KEY environment variable",
        docsUrl: "https://console.anthropic.com/settings/keys",
      },
      example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
    });
  }
  const Anthropic = await loadAnthropicSdk();
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
        // CR-402 fix: Anthropic requires tool results as content blocks with
        // type:"tool_result", not as plain user messages. The previous coercion
        // (role:"user" with string content) silently dropped the tool_use_id
        // link, causing Anthropic to reject multi-turn tool conversations.
        if (m.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.toolCallId ?? "",
                content: m.content,
              },
            ],
          } as Anthropic.MessageParam;
        }
        // Fallback for any unknown role — plain user message
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
      case "refusal":
        return "content_filter";
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

        // Translate provider-neutral ToolDefinition[] to Anthropic's tool format.
        // Anthropic uses "input_schema" (snake_case) instead of "inputSchema".
        const anthropicTools = request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));

        // Never pass stream:true, so the SDK always returns a Message.
        // Cast params as `any` to avoid the overload-union inference trap;
        // cast result as `Anthropic.Message` so downstream accesses are typed.
        const response = (await client.messages.create({
          model: request.model,
          system,
          messages,
          max_tokens: request.maxTokens || DEFAULT_MAX_TOKENS,
          stop_sequences: request.stop,
          ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)) as Anthropic.Message;

        // Current Claude models think by default, so the reply is a list of
        // blocks with thinking first and the answer after it. The answer is
        // every text block, in order; reading only the first block returns
        // an empty string.
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => (block as Anthropic.TextBlock).text)
          .join("");

        // Extract tool calls from ToolUseBlock items (tool_use responses have no text block).
        const toolCalls: ToolCall[] = response.content
          .filter((block) => block.type === "tool_use")
          .map((block) => {
            const tb = block as {
              type: "tool_use";
              id: string;
              name: string;
              input: unknown;
            };
            return { id: tb.id, name: tb.name, input: tb.input };
          });

        return {
          text,
          usage: {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens:
              response.usage.input_tokens + response.usage.output_tokens,
          },
          finishReason: transformFinishReason(response.stop_reason),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          raw: response,
        };
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new SymplekError({
          code: "PROVIDER_ERROR",
          why: `Anthropic request failed: ${detail}`,
          fix: {
            description:
              "Verify ANTHROPIC_API_KEY is set and the model name is correct.",
            docsUrl: "https://docs.anthropic.com/en/api/getting-started",
          },
          example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    async *stream(request: AIRequest): AsyncIterable<StreamChunk> {
      try {
        const { system, messages } = transformMessages(request.messages);
        // N61 fix: pass the AbortSignal as an HTTP-level option so the Anthropic
        // SDK can abort the in-flight request rather than just breaking out of
        // the for-await loop after the next chunk arrives.
        const stream = await client.messages.stream(
          {
            model: request.model,
            system,
            messages,
            max_tokens: request.maxTokens || DEFAULT_MAX_TOKENS,
            stop_sequences: request.stop,
          },
          request.signal ? { signal: request.signal } : undefined,
        );

        // H5 fix: track prompt tokens from message_start so the message_delta
        // usage chunk can emit a complete (promptTokens + completionTokens) total.
        // Previously message_delta emitted promptTokens:0, causing undercounted totals.
        let promptTokensSeen = 0;

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield { textDelta: event.delta.text };
          } else if (event.type === "message_start") {
            // H5 fix: emit usage as a dedicated chunk (textDelta:"" is intentional —
            // streaming.ts must NOT gate usage accumulation on textDelta truthiness).
            // Callers of the public stream() AsyncGenerator<string> never see this chunk;
            // streaming.ts accumulates it internally.
            promptTokensSeen = event.message.usage.input_tokens;
            yield {
              textDelta: "",
              usage: {
                promptTokens: event.message.usage.input_tokens,
                completionTokens: 0,
                totalTokens: event.message.usage.input_tokens,
              },
            };
          } else if (event.type === "message_delta") {
            // H5 fix: combine prompt tokens (from message_start) with output tokens
            // (from message_delta) so the emitted usage is a complete, accurate total.
            // Previously this emitted promptTokens:0, underreporting usage.
            const completionTokens = event.usage?.output_tokens ?? 0;
            yield {
              textDelta: "",
              finishReason: transformFinishReason(event.delta.stop_reason),
              usage: {
                promptTokens: promptTokensSeen,
                completionTokens,
                totalTokens: promptTokensSeen + completionTokens,
              },
            };
          }
        }
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new SymplekError({
          code: "PROVIDER_ERROR",
          why: `Anthropic streaming failed: ${detail}`,
          fix: {
            description:
              "Verify ANTHROPIC_API_KEY is set and streaming is supported for the requested model.",
            docsUrl: "https://docs.anthropic.com/en/api/messages-streaming",
          },
          example: 'process.env.ANTHROPIC_API_KEY = "sk-ant-...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    identify() {
      return { id: "anthropic", name: "Anthropic" };
    },
  };
}
