import { type Content, GoogleGenerativeAI } from "@google/generative-ai";
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
 * Google Gemini Provider Adapter
 */
export function createGoogleProvider(apiKey: string): Provider {
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
  const genAI = new GoogleGenerativeAI(apiKey);

  const capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    vision: true,
    structuredOutput: true,
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

        const result = await model.generateContent({
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            stopSequences: request.stop,
            topP: request.topP,
            responseMimeType:
              request.responseFormat?.type === "json_object"
                ? "application/json"
                : "text/plain",
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
        const { systemInstruction, contents } = transformMessages(
          request.messages,
        );
        const model = genAI.getGenerativeModel({
          model: request.model,
          systemInstruction,
        });

        const result = await model.generateContentStream({
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            stopSequences: request.stop,
            topP: request.topP,
            responseMimeType:
              request.responseFormat?.type === "json_object"
                ? "application/json"
                : "text/plain",
          },
        });

        for await (const chunk of result.stream) {
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

    identify() {
      return { id: "google", name: "Google" };
    },
  };
}
