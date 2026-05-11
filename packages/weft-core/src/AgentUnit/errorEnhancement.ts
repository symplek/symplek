/**
 * @module AgentUnit/errorEnhancement
 * @description Standalone error enhancement functions extracted from AgentUnit class.
 *   These functions were formerly private class methods but are pure utilities
 *   that accept operatorChain/metadata as parameters.
 * @blast_radius MEDIUM
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { ErrorCode, WeftErrorDetail } from "../errors";
import { COLORS, ERROR_PATTERNS, FIX_SUGGESTIONS } from "./errorMessages";

/** Detect error code from error message and name. */
export function detectErrorCode(error: Error): ErrorCode {
  const searchText = `${error.name} ${error.message}`;
  for (const [pattern, code] of ERROR_PATTERNS) {
    if (pattern.test(searchText)) {
      return code;
    }
  }
  return "E000";
}

/** Build an enhanced error message with context. */
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

/** Format a WeftErrorDetail for console output with optional colors. */
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

  if (
    weftError.location?.operatorChain &&
    weftError.location.operatorChain.length > 0
  ) {
    const chain = weftError.location.operatorChain.join(" → ");
    lines.push(`${c.dim}  chain: ${chain}${c.reset}`);
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

/** Enhance an error with WeftError metadata. */
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

/** Enhance, log, and re-throw an error. */
export function handleError(error: Error, operatorChain: string[]): never {
  const enhancedError = enhanceError(error, operatorChain);
  console.error(formatForConsole(enhancedError.WeftError));
  throw enhancedError;
}
