import type { Content } from "@google/generative-ai";
import { WeftError } from "../errors";
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
} from "./interface";

// ── Lazy SDK loader ──────────────────────────────────────────────────────────
// No top-level import of @google/generative-ai. The SDK is loaded on first
// factory call and cached for the process lifetime — import() is called once.

type GoogleGenAIMod = typeof import("@google/generative-ai");
let _GoogleSdk: GoogleGenAIMod | null = null;

async function loadGoogleSdk(): Promise<GoogleGenAIMod> {
  if (_GoogleSdk !== null) return _GoogleSdk;
  try {
    const mod = await import("@google/generative-ai");
    _GoogleSdk = mod;
    return _GoogleSdk;
  } catch {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      why: "@google/generative-ai is not installed. Run: pnpm add @google/generative-ai",
      fix: {
        description: "Run: pnpm add @google/generative-ai",
        docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
      },
      example: "pnpm add @google/generative-ai",
    });
  }
}

/**
 * Google Gemini Provider Adapter
 */
export async function createGoogleProvider(
  apiKey: string,
): Promise<Provider> {
  if (!apiKey) {
    throw new WeftError({
      code: "PROVIDER_ERROR",
      why: "GOOGLE_GENERATIVE_AI_API_KEY is not set",
      fix: {
        description:
          "Set the GOOGLE_GENERATIVE_AI_API_KEY environment variable",
        docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
      },
      example: 'process.env.GOOGLE_GENERATIVE_AI_API_KEY = "AIza...";',
    });
  }
  const { GoogleGenerativeAI } = await loadGoogleSdk();
  const genAI = new GoogleGenerativeAI(apiKey);

  const capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
    // Google supports responseSchema for constrained JSON output.
    // Enforcement is best-effort (nullable fields unsupported; see validateSchemaForProvider).
    strictStructuredOutput: true,
    maxContextTokens: 1000000, // Gemini 1.5 Pro
  };

  function transformMessages(messages: AIMessage[]): {
    systemInstruction?: string;
    contents: Content[];
  } {
    const systemInstruction = messages.find(
      (m) => m.role === "system",
    )?.content;
    const contents: Content[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        const role = m.role === "assistant" ? "model" : "user";
        return {
          role,
          parts: [{ text: m.content }],
        };
      });

    return { systemInstruction, contents };
  }

  function transformFinishReason(
    reason: string | null | undefined,
  ): AIResponse["finishReason"] {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
        return "content_filter";
      case "RECITATION":
        return "content_filter";
      default:
        return "other";
    }
  }

  /**
   * Build Google generationConfig fields for the requested response format.
   * json_schema passes the schema as responseSchema (best-effort enforcement).
   * Note: nullable fields are not supported in responseSchema.
   * The schema is cast to `any` to satisfy the Google SDK's Schema union type;
   * our ResponseFormat.schema is a plain JSON Schema object.
   */
  function buildGoogleGenerationConfig(
    format: ResponseFormat | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { responseMimeType?: string; responseSchema?: any } {
    if (!format || format.type === "text") return { responseMimeType: "text/plain" };
    if (format.type === "json_object") return { responseMimeType: "application/json" };
    // json_schema: pass schema for constrained output
    return {
      responseMimeType: "application/json",
      responseSchema: format.schema,
    };
  }

  return {
    id: "google",
    name: "Google",
    capabilities,

    async generate(request: AIRequest): Promise<AIResponse> {
      try {
        const { systemInstruction, contents } = transformMessages(
          request.messages,
        );
        const model = genAI.getGenerativeModel({
          model: request.model,
          systemInstruction,
        });

        const fmtConfig = buildGoogleGenerationConfig(request.responseFormat);
        const result = await model.generateContent({
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            stopSequences: request.stop,
            topP: request.topP,
            ...fmtConfig,
          },
        });

        const response = result.response;
        const text = response.text();

        return {
          text,
          usage: {
            promptTokens: response.usageMetadata?.promptTokenCount || 0,
            completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata?.totalTokenCount || 0,
          },
          finishReason: transformFinishReason(
            response.candidates?.[0]?.finishReason,
          ),
          raw: response,
        };
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `Google Gemini request failed: ${detail}`,
          fix: {
            description:
              "Verify GOOGLE_GENERATIVE_AI_API_KEY is set and the model name is correct.",
            docsUrl: "https://ai.google.dev/gemini-api/docs/api-key",
          },
          example: 'process.env.GOOGLE_GENERATIVE_AI_API_KEY = "AIza...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    async *stream(request: AIRequest): AsyncIterable<StreamChunk> {
      try {
        // N61 fix: early-exit if already cancelled before starting the request.
        if (request.signal?.aborted) {
          return;
        }

        const { systemInstruction, contents } = transformMessages(
          request.messages,
        );
        const model = genAI.getGenerativeModel({
          model: request.model,
          systemInstruction,
        });

        const fmtConfig = buildGoogleGenerationConfig(request.responseFormat);
        const result = await model.generateContentStream({
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            stopSequences: request.stop,
            topP: request.topP,
            ...fmtConfig,
          },
        });

        for await (const chunk of result.stream) {
          // N61 fix: check the signal on each chunk so a cancelled stream stops
          // as soon as the current chunk yields, rather than continuing to the end.
          if (request.signal?.aborted) {
            return;
          }
          yield {
            textDelta: chunk.text(),
            usage: chunk.usageMetadata
              ? {
                  promptTokens: chunk.usageMetadata.promptTokenCount,
                  completionTokens: chunk.usageMetadata.candidatesTokenCount,
                  totalTokens: chunk.usageMetadata.totalTokenCount,
                }
              : undefined,
            finishReason: chunk.candidates?.[0]?.finishReason
              ? transformFinishReason(chunk.candidates[0].finishReason)
              : undefined,
          };
        }
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `Google Gemini streaming failed: ${detail}`,
          fix: {
            description:
              "Verify GOOGLE_GENERATIVE_AI_API_KEY is set and streaming is supported for the requested model.",
            docsUrl:
              "https://ai.google.dev/gemini-api/docs/text-generation#generate-a-text-stream",
          },
          example: 'process.env.GOOGLE_GENERATIVE_AI_API_KEY = "AIza...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    async *streamParts(request: AIRequest): AsyncIterable<StreamPart> {
      try {
        if (request.signal?.aborted) return;

        const { systemInstruction, contents } = transformMessages(request.messages);
        const model = genAI.getGenerativeModel({ model: request.model, systemInstruction });

        const fmtConfig = buildGoogleGenerationConfig(request.responseFormat);
        const result = await model.generateContentStream({
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            stopSequences: request.stop,
            topP: request.topP,
            ...fmtConfig,
          },
        });

        for await (const chunk of result.stream) {
          if (request.signal?.aborted) return; // abort: no FinishPart
          const text = chunk.text();
          if (text) yield { type: "text-delta", textDelta: text };
        }

        // Google emits usage only on the aggregated response, not per-chunk
        const response = await result.response;
        const usage = {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        };
        yield {
          type: "finish",
          finishReason: transformFinishReason(response.candidates?.[0]?.finishReason),
          usage,
        } satisfies FinishPart;
      } catch (error: unknown) {
        const detail = redactErrorMessage(apiKey, error);
        throw new WeftError({
          code: "PROVIDER_ERROR",
          why: `Google Gemini streamParts failed: ${detail}`,
          fix: {
            description:
              "Verify GOOGLE_GENERATIVE_AI_API_KEY is set and streaming is supported for the requested model.",
            docsUrl:
              "https://ai.google.dev/gemini-api/docs/text-generation#generate-a-text-stream",
          },
          example: 'process.env.GOOGLE_GENERATIVE_AI_API_KEY = "AIza...";',
          cause: safeCause(apiKey, error),
        });
      }
    },

    identify() {
      return { id: "google", name: "Google" };
    },
  };
}
