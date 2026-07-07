/**
 * @module AgentUnit/diagnostics
 * @description Error detection constants, fix suggestions, and helper functions
 *   extracted from AgentUnit for size compliance. All functions are module-level
 *   (stateless) and take explicit parameters instead of relying on class `this`.
 * @blast_radius HIGH - All agent error reporting depends on these constants
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { ObjectiveConfidence } from "../confidence";
import type { ErrorCode, WeftErrorDetail } from "../errors";
import type { AgentContext, ResultSource, TrackedResult } from "../types";
import { createTrackedResult } from "../trust";
import type { AgentUnitMetadata } from "./AgentUnit";

// ─────────────────────────────────────────────────────────────────────────────
// ERROR DETECTION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

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

export const FIX_SUGGESTIONS: Record<
  ErrorCode,
  { description: string; codeSnippet?: string; docsUrl: string }
> = {
  E000: {
    description:
      "An unknown error occurred. Check the error message and stack trace for details.",
    docsUrl: "https://Weft.ai/docs/errors",
  },
  E001: {
    description:
      "Ensure the value matches the expected type. Check your input data.",
    docsUrl: "https://Weft.ai/docs/errors/type",
  },
  E002: {
    description: "Add the required field to your configuration or input.",
    docsUrl: "https://Weft.ai/docs/errors/type",
  },
  E003: {
    description: "Change the property to a valid value type.",
    docsUrl: "https://Weft.ai/docs/errors/type",
  },
  E004: {
    description:
      "Review the schema requirements and ensure your input conforms.",
    docsUrl: "https://Weft.ai/docs/errors/type",
  },
  E005: {
    description: "Provide a non-null value or add null handling.",
    docsUrl: "https://Weft.ai/docs/errors/type",
  },
  E101: {
    description:
      "Use buildContext() to create the required context before calling the agent.",
    codeSnippet: "const context = buildContext(ctx).withUser(userId).build();",
    docsUrl: "https://Weft.ai/docs/errors/context",
  },
  E102: {
    description: "Verify the context structure matches the expected schema.",
    docsUrl: "https://Weft.ai/docs/errors/context",
  },
  E103: {
    description:
      "Create a fresh context. Consider increasing timeout for long-running operations.",
    docsUrl: "https://Weft.ai/docs/errors/context",
  },
  E104: {
    description: "Ensure the user/agent has the required permissions.",
    docsUrl: "https://Weft.ai/docs/errors/context",
  },
  E201: {
    description:
      "Increase the timeout or optimize the operation to complete faster.",
    codeSnippet: ".timeout(60000) // Increase to 60 seconds",
    docsUrl: "https://Weft.ai/docs/errors/execution",
  },
  E202: {
    description:
      "Provide more context, lower confidence threshold, or request human review.",
    codeSnippet: ".requireConfidence(0.7) // Lower threshold",
    docsUrl: "https://Weft.ai/docs/errors/execution",
  },
  E203: {
    description:
      "Wait before retrying, or use the .retry() operator with backoff.",
    codeSnippet: ".retry(3, { baseDelayMs: 1000 })",
    docsUrl: "https://Weft.ai/docs/errors/execution",
  },
  E204: {
    description:
      "Check tool implementation and ensure inputs match expected schema.",
    docsUrl: "https://Weft.ai/docs/errors/execution",
  },
  E205: {
    description:
      "Increase maxSteps, break into sub-tasks, or review agent instructions.",
    docsUrl: "https://Weft.ai/docs/errors/execution",
  },
  E301: {
    description:
      "Reduce quorum requirement, add a tiebreaker agent, or allow majority decision.",
    codeSnippet: ".consensus(voters, { quorum: 0.51 })",
    docsUrl: "https://Weft.ai/docs/errors/coordination",
  },
  E302: {
    description:
      "Revise the proposal, accept the challenge, or escalate to human review.",
    docsUrl: "https://Weft.ai/docs/errors/coordination",
  },
  E303: {
    description: "Break the circular dependency or use lazy initialization.",
    docsUrl: "https://Weft.ai/docs/errors/coordination",
  },
  E304: {
    description:
      "Ensemble coherence below threshold. Consider adding more agents, adjusting weights, or lowering threshold.",
    codeSnippet: ".coherence({ threshold: 0.70 }) // Lower threshold",
    docsUrl: "https://Weft.ai/docs/errors/coordination",
  },
  E401: {
    description:
      "Sanitize input before use. Apply input validation and escape special characters.",
    codeSnippet: ".scanned({ maxLength: 1000, allowedPatterns: [...] })",
    docsUrl: "https://Weft.ai/docs/errors/security",
  },
  E402: {
    description:
      "Verify with a trusted source, require human approval, or use zero-trust mode.",
    docsUrl: "https://Weft.ai/docs/errors/security",
  },
  E403: {
    description:
      "Only use TrackedResult created through official .tracked() method.",
    codeSnippet: ".tracked({ source: 'agent', confidence: 0.9 })",
    docsUrl: "https://Weft.ai/docs/errors/security",
  },
};

export const COLORS = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

/** Base confidence for agent-generated results. */
export const BASE_CONFIDENCE = 0.85;

/** Confidence adjustments per operator type. */
export const CONFIDENCE_ADJUSTMENTS: Record<string, number> = {
  consensus: 0.1,
  challenge: 0.05,
  verify: 0.15,
  retry: -0.05,
  fallback: -0.1,
  converge: 0.15,
  debate: 0.15,
  dialectic: 0.1,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS (stateless — take explicit params)
// ─────────────────────────────────────────────────────────────────────────────

export function detectErrorCode(error: Error): ErrorCode {
  const searchText = `${error.name} ${error.message}`;
  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(searchText)) return code;
  }
  return "E000";
}

export function buildEnhancedMessage(code: ErrorCode, error: Error): string {
  const categoryNames: Record<string, string> = {
    "0": "Type Error",
    "1": "Context Error",
    "2": "Execution Error",
    "3": "Coordination Error",
    "4": "Security Error",
  };
  const category = categoryNames[code.charAt(1)] ?? "Error";
  return `[${code}] ${category}: ${error.message}`;
}

export function formatForConsole(
  weftError: WeftErrorDetail,
  colorize = true,
): string {
  const c = colorize
    ? COLORS
    : { red: "", green: "", blue: "", cyan: "", dim: "", bold: "", reset: "" };
  const lines: string[] = [];
  lines.push(
    `${c.red}${c.bold}[${weftError.code}]${c.reset} ${weftError.message}`,
  );
  if (weftError.location?.operatorChain?.length) {
    lines.push(
      `${c.dim}  chain: ${weftError.location.operatorChain.join(" → ")}${c.reset}`,
    );
  }
  lines.push("");
  lines.push(`${c.green}${c.bold}Fix:${c.reset} ${weftError.fix.description}`);
  if (weftError.fix.codeSnippet) {
    lines.push("");
    lines.push(`${c.cyan}${weftError.fix.codeSnippet}${c.reset}`);
  }
  lines.push("");
  lines.push(`${c.blue}Docs: ${weftError.fix.docsUrl}${c.reset}`);
  return lines.join("\n");
}

export function enhanceError(
  error: Error,
  operatorChain: string[],
): Error & { WeftError: WeftErrorDetail } {
  const code = detectErrorCode(error);
  const fix = FIX_SUGGESTIONS[code];
  const detail: WeftErrorDetail = {
    code,
    message: buildEnhancedMessage(code, error),
    location: { operatorChain },
    fix: {
      description: fix.description,
      codeSnippet: fix.codeSnippet,
      docsUrl: fix.docsUrl,
    },
    originalMessage: error.message,
    timestamp: Date.now(),
  };
  (error as Error & { WeftError: WeftErrorDetail }).WeftError = detail;
  return error as Error & { WeftError: WeftErrorDetail };
}

export function handleError(error: Error, operatorChain: string[]): never {
  const enhancedError = enhanceError(error, operatorChain);
  console.error(formatForConsole(enhancedError.WeftError));
  throw enhancedError;
}

export function calculateConfidence(operatorChain: string[]): number {
  let confidence = BASE_CONFIDENCE;
  for (const operator of operatorChain) {
    const adjustment = CONFIDENCE_ADJUSTMENTS[operator];
    if (adjustment !== undefined) confidence += adjustment;
  }
  return Math.max(0, Math.min(1, confidence));
}

export function extractObjectiveConfidence<T>(
  value: T,
): ObjectiveConfidence | undefined {
  if (
    value !== null &&
    typeof value === "object" &&
    "objectiveConfidence" in value &&
    (value as Record<string, unknown>).objectiveConfidence !== undefined
  ) {
    return (value as Record<string, unknown>)
      .objectiveConfidence as ObjectiveConfidence;
  }
  return undefined;
}

export function wrapInTrackedResult<T>(
  value: T,
  metadata: AgentUnitMetadata,
  _ctx: AgentContext,
): TrackedResult<T> {
  const confidence = calculateConfidence(metadata.operatorChain);
  const source: ResultSource = "agent";
  const objectiveConfidence = extractObjectiveConfidence(value);

  const result: TrackedResult<T> = createTrackedResult(value, {
    source,
    confidence,
    sourceChain: [source],
    minChainConfidence: confidence,
    objectiveConfidence,
  });

  return result;
}
