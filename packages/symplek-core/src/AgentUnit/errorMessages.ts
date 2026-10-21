/**
 * @module AgentUnit/errorMessages
 * @description Error pattern matching, fix suggestions, and console color codes.
 *   Extracted from AgentUnit.ts to reduce class shell size.
 * @blast_radius MEDIUM
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { ErrorCode, SymplekErrorDetail } from "../errors";

/** Error patterns for automatic error code detection. */
export const ERROR_PATTERNS: Array<[RegExp, ErrorCode]> = [
  [/timeout|timed out|exceeded.*timeout/i, "E201"],
  [/confidence.*below|low confidence|uncertain/i, "E202"],
  [/rate limit|too many requests|throttle|429/i, "E203"],
  [/tool.*fail|tool.*error|execution.*fail/i, "E204"],
  [/max.*steps|step.*limit|too many steps/i, "E205"],
  [/consensus.*deadlock|deadlock.*consensus|no.*agreement/i, "E301"],
  [/challenge.*fail|thesis.*reject|antithesis/i, "E302"],
  [/circular.*depend|dependency.*cycle|cycle.*detect/i, "E303"],
  [/coherence.*below|low coherence|ensemble.*coherence/i, "E304"],
  [/injection|malicious|xss|sql.*inject/i, "E401"],
  [/untrusted|unverified.*source|trust.*fail/i, "E402"],
  [/spoof|fake.*result|invalid.*marker/i, "E403"],
  [/missing.*context|context.*required|no.*context/i, "E101"],
  [/invalid.*context|malformed.*context/i, "E102"],
  [/context.*expired|expired.*context|stale.*context/i, "E103"],
  [/permission.*denied|unauthorized|forbidden/i, "E104"],
  [/type.*mismatch|expected.*received|wrong.*type/i, "E001"],
  [/missing.*required|required.*field|field.*missing/i, "E002"],
  [/invalid.*property|property.*invalid/i, "E003"],
  [/schema.*validation|validation.*fail|invalid.*schema/i, "E004"],
  [/null|undefined|cannot read/i, "E005"],
];

/** Fix suggestions for each error code. */
export const FIX_SUGGESTIONS: Record<
  ErrorCode,
  { description: string; codeSnippet?: string; docsUrl: string }
> = {
  E000: {
    description:
      "An unknown error occurred. Check the error message and stack trace for details.",
    docsUrl: "https://symplek.com/docs/errors",
  },
  E001: {
    description:
      "Ensure the value matches the expected type. Check your input data.",
    docsUrl: "https://symplek.com/docs/errors/type",
  },
  E002: {
    description: "Add the required field to your configuration or input.",
    docsUrl: "https://symplek.com/docs/errors/type",
  },
  E003: {
    description: "Change the property to a valid value type.",
    docsUrl: "https://symplek.com/docs/errors/type",
  },
  E004: {
    description:
      "Review the schema requirements and ensure your input conforms.",
    docsUrl: "https://symplek.com/docs/errors/type",
  },
  E005: {
    description: "Provide a non-null value or add null handling.",
    docsUrl: "https://symplek.com/docs/errors/type",
  },
  E101: {
    description:
      "Use buildContext() to create the required context before calling the agent.",
    codeSnippet: "const context = buildContext(ctx).withUser(userId).build();",
    docsUrl: "https://symplek.com/docs/errors/context",
  },
  E102: {
    description: "Verify the context structure matches the expected schema.",
    docsUrl: "https://symplek.com/docs/errors/context",
  },
  E103: {
    description:
      "Create a fresh context. Consider increasing timeout for long-running operations.",
    docsUrl: "https://symplek.com/docs/errors/context",
  },
  E104: {
    description: "Ensure the user/agent has the required permissions.",
    docsUrl: "https://symplek.com/docs/errors/context",
  },
  E201: {
    description:
      "Increase the timeout or optimize the operation to complete faster.",
    codeSnippet: ".timeout(60000) // Increase to 60 seconds",
    docsUrl: "https://symplek.com/docs/errors/execution",
  },
  E202: {
    description: "Lower the confidence threshold or improve agent quality.",
    codeSnippet: ".requireConfidence(0.7) // Lower threshold",
    docsUrl: "https://symplek.com/docs/errors/execution",
  },
  E203: {
    description: "Implement retry with exponential backoff.",
    codeSnippet: ".retry(3, { baseDelayMs: 1000 })",
    docsUrl: "https://symplek.com/docs/errors/execution",
  },
  E204: {
    description:
      "Check tool configuration and ensure tools are properly registered.",
    docsUrl: "https://symplek.com/docs/errors/execution",
  },
  E205: {
    description:
      "Increase maxSteps or redesign agent to complete in fewer steps.",
    docsUrl: "https://symplek.com/docs/errors/execution",
  },
  E301: {
    description: "Increase quorum threshold or add more voters.",
    codeSnippet: ".consensus(voters, { quorum: 0.51 })",
    docsUrl: "https://symplek.com/docs/errors/coordination",
  },
  E302: {
    description:
      "Review challenge configuration and ensure valid thesis/antithesis.",
    docsUrl: "https://symplek.com/docs/errors/coordination",
  },
  E303: {
    description:
      "Restructure agent dependencies to eliminate circular references.",
    docsUrl: "https://symplek.com/docs/errors/coordination",
  },
  E304: {
    description: "Lower coherence threshold or improve agent alignment.",
    codeSnippet: ".coherence({ threshold: 0.70 }) // Lower threshold",
    docsUrl: "https://symplek.com/docs/errors/coordination",
  },
  E401: {
    description: "Sanitize inputs before passing to agents.",
    codeSnippet: ".scanned({ maxLength: 1000, allowedPatterns: [...] })",
    docsUrl: "https://symplek.com/docs/errors/security",
  },
  E402: {
    description: "Add source tracking to verify result provenance.",
    codeSnippet: ".tracked({ source: 'agent', confidence: 0.9 })",
    docsUrl: "https://symplek.com/docs/errors/security",
  },
  E403: {
    description:
      "Only use TrackedResult created through official .tracked() method.",
    codeSnippet: ".tracked({ source: 'agent', confidence: 0.9 })",
    docsUrl: "https://symplek.com/docs/errors/security",
  },
};

/** ANSI color codes for console output. */
export const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

export type ColorsType = typeof COLORS;
export type SymplekErrorDetailExport = SymplekErrorDetail;
