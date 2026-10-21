// Type-only import — erased at runtime; safe for lazy SDK loading.
import type Anthropic from "@anthropic-ai/sdk";
import { SymplekError } from "../errors";

// ── Post-hoc JSON Schema validator ──────────────────────────────────────────
// Anthropic's tool_use forcing guarantees the tool is invoked, but NOT that its
// input conforms to the schema. This validator catches violations before they
// reach the caller. Handles: type, required, properties, enum.
// For complete validation (min, max, pattern, anyOf, …) pass a zodSchema in
// ResponseFormat — the adapter uses Zod when available.

/**
 * Validates a value against a JSON Schema (subset: type, required, properties, enum).
 * Returns error messages; empty array means valid.
 *
 * @internal Exported for unit testing; not part of the public provider API.
 */
export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = "$",
): string[] {
  const errors: string[] = [];

  if (schema.type !== undefined) {
    const expectedType = schema.type as string;
    if (!_matchesSchemaType(value, expectedType)) {
      return [`${path}: expected ${expectedType}, got ${_schemaTypeOf(value)}`];
    }
  }

  // enum check: if the type matched (or was not specified), verify the value is
  // one of the enumerated values. This covers the common string-enum pattern that
  // the old walker silently accepted.
  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    const enumValues = schema.enum as unknown[];
    if (!enumValues.includes(value)) {
      const allowed = enumValues.map((v) => JSON.stringify(v)).join(", ");
      errors.push(`${path}: value ${JSON.stringify(value)} is not one of [${allowed}]`);
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return errors;
  }

  const obj = value as Record<string, unknown>;

  const required = schema.required;
  if (Array.isArray(required)) {
    for (const key of required as string[]) {
      if (!(key in obj)) {
        errors.push(`${path}: required property "${key}" is missing`);
      }
    }
  }

  const properties = schema.properties;
  if (properties != null && typeof properties === "object" && !Array.isArray(properties)) {
    const props = properties as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj) {
        errors.push(...validateJsonSchema(obj[key], propSchema, `${path}.${key}`));
      }
    }
  }

  return errors;
}

// Duck-typed interface for Zod schema validation — avoids importing Zod while
// still supporting the full Zod constraint surface (enum, min, max, regex, …).
type ZodLike = {
  safeParse: (v: unknown) => { success: boolean; error?: { message: string } };
};

/**
 * Validates structured output from an Anthropic tool_use forced call.
 * - When zodSchema is provided: uses Zod for complete validation (enum, min, etc.).
 * - Without zodSchema: falls back to the partial JSON Schema walker
 *   (type, required, properties, enum).
 * Throws SymplekError(VALIDATION_ERROR) on violation; returns void on success.
 *
 * @internal Exported for unit testing; not part of the public provider API.
 */
export function validateAnthropicStructuredOutput(
  toolInput: unknown,
  schemaObj: Record<string, unknown>,
  zodSchema?: ZodLike,
): void {
  if (zodSchema) {
    const result = zodSchema.safeParse(toolInput);
    if (!result.success) {
      throw new SymplekError({
        code: "VALIDATION_ERROR",
        why: `Anthropic structured output failed schema validation: ${result.error?.message ?? "schema violation"}`,
        fix: {
          description:
            "The model returned output that does not match the requested schema. Review your prompt and schema.",
          docsUrl: "https://docs.anthropic.com/en/api/messages",
        },
      });
    }
    return;
  }
  // Partial fallback: handles type, required, properties, enum.
  // For min/max/pattern/anyOf pass ResponseFormat.zodSchema for complete coverage.
  const errs = validateJsonSchema(toolInput, schemaObj);
  if (errs.length > 0) {
    throw new SymplekError({
      code: "VALIDATION_ERROR",
      why: `Anthropic structured output failed schema validation: ${errs.slice(0, 3).join("; ")}`,
      fix: {
        description:
          "The model returned output that does not match the requested schema. Review your prompt and schema.",
        docsUrl: "https://docs.anthropic.com/en/api/messages",
      },
    });
  }
}

function _matchesSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":  return typeof value === "string";
    case "number":  return typeof value === "number";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array":   return Array.isArray(value);
    case "null":    return value === null;
    case "object":  return typeof value === "object" && value !== null && !Array.isArray(value);
    default:        return true;
  }
}

function _schemaTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
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
 * Converts provider-neutral AIMessage[] into Anthropic MessageParam[].
 *
 * Critical correctness requirement: assistant turns that returned tool calls
 * MUST emit `tool_use` content blocks (one per call) so that the subsequent
 * `tool_result` blocks have matching `tool_use_id` values. Anthropic rejects
 * conversations where a `tool_result` references a `tool_use_id` that was
 * never sent as a `tool_use` block.
 *
 * @internal Exported for unit testing; not part of the public provider API.
 */
export function transformAnthropicMessages(messages: AIMessage[]): {
  system?: string;
  messages: Anthropic.MessageParam[];
} {
  const system = messages.find((m) => m.role === "system")?.content;
  const filteredMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "user")
        return { role: "user", content: m.content } as Anthropic.MessageParam;

      if (m.role === "assistant") {
        const toolCalls = m.toolCalls;
        if (toolCalls && toolCalls.length > 0) {
          // Anthropic requires tool_use content blocks in the assistant turn that
          // immediately precede each tool_result block. The text prefix (if any)
          // is emitted as a leading text block. Without these blocks, Anthropic
          // rejects the conversation with a 400 error.
          const contentBlocks: unknown[] = [];
          if (m.content) {
            contentBlocks.push({ type: "text", text: m.content });
          }
          for (const tc of toolCalls) {
            contentBlocks.push({
              type: "tool_use" as const,
              id: tc.id,
              name: tc.name,
              input: tc.input as Record<string, unknown>,
            });
          }
          return { role: "assistant", content: contentBlocks } as Anthropic.MessageParam;
        }
        return { role: "assistant", content: m.content } as Anthropic.MessageParam;
      }

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

/**
 * Anthropic Provider Adapter
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
    // Anthropic uses tool_use forcing for json_schema strict=true: the schema is
    // injected as a tool and tool_choice is forced to that tool. This guarantees
    // the tool is invoked but does NOT constrain generation — the model can still
    // return schema-non-conforming input. The adapter validates post-hoc:
    //   - With ResponseFormat.zodSchema: Zod validates ALL constraints (enum,
    //     min, max, pattern, …). This is the complete enforcement path.
    //   - Without zodSchema: a partial JSON Schema walker checks type, required,
    //     properties, and enum. Pass zodSchema for full constraint coverage.
    // In both cases violations throw VALIDATION_ERROR (never silent acceptance).
    strictStructuredOutput: true,
    maxContextTokens: 200000,
  };

  // transformAnthropicMessages is the inner call site; delegate to the exported
  // standalone function so tests can call it directly without a live provider.
  function transformMessages(messages: AIMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    return transformAnthropicMessages(messages);
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

  /**
   * When json_schema strict=true is requested, Anthropic enforces the schema
   * via tool_use forcing: we inject the schema as a tool definition and set
   * tool_choice to that tool. The model MUST invoke it, guaranteeing the output
   * matches the schema. Returns the extra params to merge into the SDK call.
   */
  function buildStructuredOutputParams(
    format: ResponseFormat | undefined,
    existingTools: Anthropic.Messages.Tool[] | undefined,
  ): {
    tools?: Anthropic.Messages.Tool[];
    tool_choice?: Anthropic.Messages.ToolChoiceTool;
    isToolForced: boolean;
  } {
    if (format?.type !== "json_schema" || !format.strict) {
      return { tools: existingTools, isToolForced: false };
    }
    const schemaName = format.name;
    const schemaTool: Anthropic.Messages.Tool = {
      name: schemaName,
      description: `Return structured data matching the ${schemaName} schema`,
      input_schema: format.schema as Anthropic.Messages.Tool["input_schema"],
    };
    const allTools = [...(existingTools ?? []), schemaTool];
    return {
      tools: allTools,
      tool_choice: { type: "tool", name: schemaName },
      isToolForced: true,
    };
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
        })) as Anthropic.Messages.Tool[] | undefined;

        // CR-502: json_schema strict=true uses tool_use forcing for schema enforcement.
        const { tools, tool_choice, isToolForced } = buildStructuredOutputParams(
          request.responseFormat,
          anthropicTools,
        );

        // Never pass stream:true, so the SDK always returns a Message.
        const response = (await client.messages.create({
          model: request.model,
          system,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          stop_sequences: request.stop,
          top_p: request.topP,
          ...(tools?.length ? { tools, ...(tool_choice ? { tool_choice } : {}) } : {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)) as Anthropic.Message;

        // When tool_use forcing is active, the structured output is in the
        // tool_use block's input, not a text block. Validate against the schema
        // before serialising — violations throw VALIDATION_ERROR rather than
        // reaching the caller as silent garbage.
        if (isToolForced) {
          const schemaName = (request.responseFormat as { name: string }).name;
          const schemaObj = (request.responseFormat as { schema: Record<string, unknown> }).schema;
          const zodSchema = (request.responseFormat as { zodSchema?: ZodLike }).zodSchema;
          // Use any[] cast to avoid Anthropic SDK's discriminated union mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolBlock = (response.content as any[]).find(
            (b: { type: string; name?: string }) =>
              b.type === "tool_use" && b.name === schemaName,
          ) as { input: unknown } | undefined;

          if (!toolBlock) {
            throw new SymplekError({
              code: "VALIDATION_ERROR",
              why: "Anthropic did not invoke the required schema tool; structured output unavailable.",
              fix: {
                description:
                  "The model did not return the expected structured output. Retry or adjust your prompt.",
                docsUrl: "https://docs.anthropic.com/en/api/messages",
              },
            });
          }

          validateAnthropicStructuredOutput(toolBlock.input, schemaObj, zodSchema);

          const structuredText = JSON.stringify(toolBlock.input);
          return {
            text: structuredText,
            usage: {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            },
            finishReason: transformFinishReason(response.stop_reason),
            raw: response,
          };
        }

        // Standard path: extract text from TextBlock items.
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => (block as { type: "text"; text: string }).text)
          .join("");

        // Extract tool calls from ToolUseBlock items.
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
        const anthropicTools = request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })) as Anthropic.Messages.Tool[] | undefined;

        // CR-502: tool_use forcing for json_schema strict=true.
        const { tools, tool_choice, isToolForced } = buildStructuredOutputParams(
          request.responseFormat,
          anthropicTools,
        );

        // N61 fix: pass the AbortSignal as an HTTP-level option so the Anthropic
        // SDK can abort the in-flight request rather than just breaking out of
        // the for-await loop after the next chunk arrives.
        const stream = await client.messages.stream(
          {
            model: request.model,
            system,
            messages,
            max_tokens: request.maxTokens || 4096,
            temperature: request.temperature,
            stop_sequences: request.stop,
            top_p: request.topP,
            ...(tools?.length ? { tools, ...(tool_choice ? { tool_choice } : {}) } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          request.signal ? { signal: request.signal } : undefined,
        );

        // H5 fix: track prompt tokens from message_start.
        let promptTokensSeen = 0;

        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              yield { textDelta: event.delta.text };
            } else if (isToolForced && (event.delta as { type: string; partial_json?: string }).type === "input_json_delta") {
              // Tool_use forcing: stream the partial JSON as text so callers
              // can observe the structured output as it arrives.
              const partial = (event.delta as { partial_json?: string }).partial_json ?? "";
              if (partial) yield { textDelta: partial };
            }
          } else if (event.type === "message_start") {
            // H5 fix: emit usage as a dedicated chunk (textDelta:"" is intentional).
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
            // H5 fix: combine prompt + output tokens into an accurate total.
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

    async *streamParts(request: AIRequest): AsyncIterable<StreamPart> {
      try {
        const { system, messages } = transformMessages(request.messages);
        const anthropicTools = request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })) as Anthropic.Messages.Tool[] | undefined;

        const { tools, tool_choice, isToolForced } = buildStructuredOutputParams(
          request.responseFormat,
          anthropicTools,
        );

        const stream = await client.messages.stream(
          {
            model: request.model,
            system,
            messages,
            max_tokens: request.maxTokens || 4096,
            temperature: request.temperature,
            stop_sequences: request.stop,
            top_p: request.topP,
            ...(tools?.length ? { tools, ...(tool_choice ? { tool_choice } : {}) } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          request.signal ? { signal: request.signal } : undefined,
        );

        let promptTokensSeen = 0;
        // Buffer for assembling tool_use input incrementally
        const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();

        for await (const event of stream) {
          if (request.signal?.aborted) return; // abort: no FinishPart

          if (event.type === "content_block_start") {
            const block = event.content_block as {
              type: string;
              id?: string;
              name?: string;
            };
            if (block.type === "tool_use") {
              toolInputBuffers.set(event.index, { id: block.id ?? "", name: block.name ?? "", json: "" });
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
            if (delta.type === "text_delta" && delta.text) {
              yield { type: "text-delta", textDelta: delta.text };
            } else if (delta.type === "thinking_delta" && delta.thinking) {
              yield { type: "reasoning", reasoning: delta.thinking };
            } else if (delta.type === "input_json_delta" && delta.partial_json) {
              const buf = toolInputBuffers.get(event.index);
              if (buf) buf.json += delta.partial_json;
              // When tool_use forcing, also stream as text-delta for stream() parity
              if (isToolForced && delta.partial_json) {
                yield { type: "text-delta", textDelta: delta.partial_json };
              }
            }
          } else if (event.type === "content_block_stop") {
            const buf = toolInputBuffers.get(event.index);
            if (buf && buf.id) {
              let input: unknown;
              try { input = JSON.parse(buf.json || "{}"); } catch { input = buf.json; }

              // When tool-forcing is active and this is the schema tool, validate
              // the assembled input before yielding — violations surface as errors.
              if (isToolForced && buf.name === (request.responseFormat as { name: string }).name) {
                const schemaObj = (request.responseFormat as { schema: Record<string, unknown> }).schema;
                const zodSchema = (request.responseFormat as { zodSchema?: ZodLike }).zodSchema;
                validateAnthropicStructuredOutput(input, schemaObj, zodSchema);
              }

              yield {
                type: "tool-call",
                toolCallId: buf.id,
                toolName: buf.name,
                input,
              } satisfies ToolCallPart;
              toolInputBuffers.delete(event.index);
            }
          } else if (event.type === "message_start") {
            promptTokensSeen = event.message.usage.input_tokens;
          } else if (event.type === "message_delta") {
            const completionTokens = event.usage?.output_tokens ?? 0;
            yield {
              type: "finish",
              finishReason: transformFinishReason(event.delta.stop_reason),
              usage: {
                promptTokens: promptTokensSeen,
                completionTokens,
                totalTokens: promptTokensSeen + completionTokens,
              },
            } satisfies FinishPart;
          }
        }
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new SymplekError({
          code: "PROVIDER_ERROR",
          why: `Anthropic streamParts failed: ${detail}`,
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
