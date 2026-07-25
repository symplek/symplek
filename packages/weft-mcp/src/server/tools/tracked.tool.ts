/**
 * @module TrackedTool - MCP tool definition for the Weft tracked operator
 * @description Wires weft_tracked MCP calls to AgentUnit.tracked() operator.
 * Wraps the prompt with source-chain provenance and adds a SHA-256 content hash
 * for downstream claim verification.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createHash } from "node:crypto";
import { AgentUnit, createContext } from "weft-core";

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const trackedTool = {
  name: "weft_tracked",
  // N57 fix: removed "verifiable source" language. The hash now covers both the
  // prompt text and the source URI so the binding is tamper-evident, but we make
  // no claim about verifying the source's external trustworthiness.
  description:
    "Wrap a value with source-chain provenance. Records the source URI, confidence score, and a SHA-256 content hash (covers prompt text + source URI) for downstream tracking.",
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        maxLength: 16_384,
        description: "The agent prompt or claim to track",
      },
      source: {
        type: "string",
        maxLength: 2_048,
        description: "Source URI (file path or URL)",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence score (0.0–1.0)",
      },
    },
    required: ["prompt", "source", "confidence"],
  },
  execute: async (input: {
    prompt: string;
    source: string;
    confidence: number;
  }): Promise<{
    value: string;
    source: string;
    confidence: number;
    hash: string;
    timestamp: string;
  }> => {
    const ctx = createContext();

    // Use trustMode: 'legacy' so the return type is TrackedResult<string>
    // (not TrackedResult<TrackedResult<string>> from double-wrapping in zero-trust mode).
    const tracked = await AgentUnit.of(input.prompt)
      .tracked({ source: "agent", confidence: input.confidence })
      .run(ctx, { trustMode: "legacy" });

    // N57 fix: bind source URI into the hash so the same prompt at a different
    // source produces a different hash. Previously hashing only the prompt meant
    // callers could substitute an arbitrary source URI without breaking the hash.
    const hash = `sha256:${createHash("sha256")
      .update(input.prompt)
      .update("|")
      .update(input.source)
      .digest("hex")}`;

    return {
      value: tracked.value,
      source: input.source,
      confidence: tracked.confidence,
      hash,
      timestamp: new Date().toISOString(),
    };
  },
};
