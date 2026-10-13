/**
 * @module TrackedTool - MCP tool definition for the weft_tracked tool
 * @description Records a caller-supplied claim with its stated source URI,
 * confidence, a SHA-256 content hash, and an ISO-8601 timestamp. Nothing is
 * verified: source and confidence are the caller's own assertions, recorded
 * verbatim. The hash is deterministic for the same (prompt, source) pair and
 * is tamper-evident for the content, not the source's external trustworthiness.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createHash } from "node:crypto";

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const trackedTool = {
  name: "weft_tracked",
  description:
    "Record a claim with its stated source URI and confidence score. " +
    "Returns the claim unchanged with a SHA-256 content hash (covers prompt + source URI) " +
    "and a timestamp. " +
    "Source and confidence are the caller's own assertions — nothing is verified or attested. " +
    "Use the hash to detect accidental or adversarial content changes across turns.",
  inputSchema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        maxLength: 16_384,
        description: "The agent prompt or claim to record",
      },
      source: {
        type: "string",
        maxLength: 2_048,
        description: "Source URI (file path or URL) — recorded as stated, not verified",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence score (0.0–1.0) — recorded as stated, not verified",
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
    notice: string;
  }> => {
    // M7 fix: use JSON.stringify([prompt, source]) as hash input so that a
    // separator character inside prompt cannot bleed into source and produce
    // the same hash as a different (prompt, source) split.
    // e.g. prompt="a|b", source="c" vs prompt="a", source="b|c" previously
    // both produced SHA256("a|b|c") — now they produce different hashes.
    const hash = `sha256:${createHash("sha256")
      .update(JSON.stringify([input.prompt, input.source]))
      .digest("hex")}`;

    return {
      value: input.prompt,
      source: input.source,
      confidence: input.confidence,
      hash,
      timestamp: new Date().toISOString(),
      // M7 fix: state explicitly that nothing was verified so a calling agent
      // cannot mistake this result for external attestation.
      notice:
        "Source and confidence are the caller's own claims, recorded verbatim. " +
        "Nothing was verified or attested. " +
        "The hash is tamper-evident for (prompt + source); it does not certify the source's trustworthiness.",
    };
  },
};
