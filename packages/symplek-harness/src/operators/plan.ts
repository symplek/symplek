/**
 * @module PlanOperator
 * @description plan() operator for @symplek/harness — runs the Claude Agent SDK in read-only
 * mode, accumulates tool calls, and produces a deterministically-IDed PlanArtifact wrapped
 * in TrackedResult<PlanArtifact> inside an AgentUnit. When the SDK is not installed the
 * operator falls back to a stub plan built from declared tools.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { createHash } from "node:crypto";
import { AgentUnit, createTrackedResult } from "@symplek/core";
import type { ResultSource, TrackedResult } from "@symplek/core";
import { LowProvenanceError } from "../errors";
import type {
  HarnessConfig,
  ImpactTier,
  PlanArtifact,
  PlanOptions,
  PlanStep,
  PlanUnit,
  SourceRef,
} from "../types";

// ─── Minimal Claude Agent SDK interface stub ──────────────────────────────
// Typed locally so the file compiles whether or not the SDK peer dep is installed.

interface SDKContent {
  type: string;
  text?: string;
}

interface SDKEvent {
  type: string;
  content?: SDKContent[];
}

interface SDKRunOptions {
  permissionMode: string;
  canUseTool?: (
    toolName: string,
    args: unknown,
  ) => { behavior: "allow" | "block" };
  onEvent?: (event: SDKEvent) => void;
}

interface SDKRunResult {
  finalMessage: string;
}

interface ClaudeAgentSession {
  run(prompt: string, options: SDKRunOptions): Promise<SDKRunResult>;
}

// ─── Internals ────────────────────────────────────────────────────────────

interface ToolCallRecord {
  tool: string;
  args: unknown;
  reasoning: string;
}

const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
]);
const FILE_TOOLS = new Set(["Read", "Glob", "Grep"]);
const WRITE_SHELL_TOOLS = new Set(["Edit", "Write", "Bash"]);
const WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);
const HIGH_RISK_RE = /\b(auth|security|schema|migration)\b/i;

function heuristicTier(intent: string, tools: readonly string[]): ImpactTier {
  const hasWriteShell = tools.some((t) => WRITE_SHELL_TOOLS.has(t));
  if (hasWriteShell && HIGH_RISK_RE.test(intent)) return "P0";
  if (hasWriteShell) return "P1";
  const hasWeb = tools.some((t) => WEB_TOOLS.has(t));
  if (hasWeb) return "P2";
  return "P3";
}

/**
 * Classifies the impact tier for a plan. Attempts to delegate to
 * `@symplek/pro`'s changeKernel classifier when available; otherwise falls back
 * to a local heuristic so the harness remains functional without the pro pkg.
 */
async function classifyImpactTier(
  intent: string,
  tools: readonly string[],
): Promise<ImpactTier> {
  try {
    // Use a string variable so TypeScript cannot statically resolve this
    // optional peer dep — the import throws at runtime if absent.
    const specifier: string = "@symplek/pro";
    const mod = (await import(specifier)) as any;
    if (typeof mod?.changeKernel?.classify === "function") {
      return (await mod.changeKernel.classify(intent, tools)) as ImpactTier;
    }
  } catch {
    // @symplek/pro not installed — heuristic follows
  }
  return heuristicTier(intent, tools);
}

function computePlanId(steps: readonly PlanStep[]): string {
  const sorted = [...steps].sort((a, b) => a.index - b.index);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function resolveUri(args: unknown): string {
  if (args !== null && typeof args === "object") {
    const first = Object.values(args as Record<string, unknown>)[0];
    return first !== undefined ? String(first) : "";
  }
  return "";
}

async function buildPlanArtifact(
  intent: string,
  accumulator: ToolCallRecord[],
): Promise<PlanArtifact> {
  const steps: PlanStep[] = accumulator.map((record, i) => ({
    index: i,
    tool: record.tool,
    targetPath: resolveUri(record.args) || undefined,
    reasoning: record.reasoning,
    dependsOn: i > 0 ? [i - 1] : [],
  }));

  const sources: SourceRef[] = accumulator
    .filter(
      (r) =>
        r.tool === "Read" ||
        r.tool === "Grep" ||
        r.tool === "WebSearch" ||
        r.tool === "WebFetch",
    )
    .map(
      (r): SourceRef => ({
        kind: FILE_TOOLS.has(r.tool) ? "file" : "web",
        uri: resolveUri(r.args),
        // File tools: hash the resolved URI for a stable content fingerprint.
        // Web tools: hash the args JSON since the actual response is not yet available.
        contentHash: FILE_TOOLS.has(r.tool)
          ? createHash("sha256")
              .update(resolveUri(r.args))
              .digest("hex")
              .slice(0, 12)
          : createHash("sha256")
              .update(JSON.stringify(r.args))
              .digest("hex")
              .slice(0, 12),
        // Per-tool confidence reflects source reliability:
        //   WebFetch: 0.85 (direct URL fetch, high fidelity)
        //   WebSearch: 0.70 (search index snippet, lower fidelity)
        //   File tools (Read/Grep): 0.80 (local codebase, high fidelity)
        confidence:
          r.tool === "WebFetch" ? 0.85 : r.tool === "WebSearch" ? 0.7 : 0.8,
      }),
    );

  const requiredTools = [...new Set(accumulator.map((r) => r.tool))];
  const estimatedImpact = await classifyImpactTier(intent, requiredTools);
  const id = computePlanId(steps);

  return { id, intent, steps, requiredTools, estimatedImpact, sources };
}

// ─── SDK session factory (optional peer dep) ──────────────────────────────
// Wired at runtime when @anthropic-ai/claude-agent-sdk is installed.
// W1-B does not call the real SDK; stub behaviour always runs.
// Replace `null` with the actual SDK client construction in W1-B final wiring.
async function tryLoadSession(
  _config: HarnessConfig,
): Promise<ClaudeAgentSession | null> {
  // TODO(W1-B-wiring): instantiate from @anthropic-ai/claude-agent-sdk once published.
  // Example:
  //   const { Claude } = await import("@anthropic-ai/claude-agent-sdk");
  //   return new Claude({ model: config.model ?? "claude-opus-4-5" });
  return null;
}

// ─── Exported operator ────────────────────────────────────────────────────

/**
 * Creates an AgentUnit that produces a TrackedResult<PlanArtifact>.
 *
 * The unit runs the Claude Agent SDK in read-only permission mode, recording
 * every permitted tool call (Read, Glob, Grep, WebSearch, WebFetch) into an
 * accumulator. After the session the accumulator is shaped into a PlanArtifact
 * with a deterministic SHA-256 ID and wrapped in TrackedResult.
 */
export function makePlanUnit(
  intent: string,
  options: PlanOptions | undefined,
  config: HarnessConfig,
): PlanUnit {
  const unit = AgentUnit.from(async (_ctx) => {
    const accumulator: ToolCallRecord[] = [];
    let lastAssistantText = "";

    const sdkSession = await tryLoadSession(config);

    config.onProgress?.({
      phase: "planning",
      message: "Starting plan session",
    });

    if (sdkSession) {
      await sdkSession.run(intent, {
        permissionMode: "default",
        canUseTool: (toolName, args) => {
          if (READ_ONLY_TOOLS.has(toolName)) {
            accumulator.push({
              tool: toolName,
              args,
              reasoning: lastAssistantText,
            });
            config.onProgress?.({ phase: "planning", tool: toolName });
            return { behavior: "allow" };
          }
          return { behavior: "block" };
        },
        onEvent: (event) => {
          if (event.type === "assistant" && Array.isArray(event.content)) {
            const textBlock = event.content.find((c) => c.type === "text");
            if (textBlock?.text) {
              lastAssistantText = textBlock.text;
            }
          }
        },
      });
    } else {
      // Stub path: synthesise a plan from the declared tool list.
      const declaredTools = options?.tools ?? config.tools ?? ["Read", "Grep"];
      const maxSteps = options?.maxSteps ?? declaredTools.length;
      for (const tool of declaredTools.slice(0, maxSteps)) {
        if (READ_ONLY_TOOLS.has(tool)) {
          accumulator.push({
            tool,
            args: {},
            reasoning: `Exploratory ${tool} call for: ${intent}`,
          });
          config.onProgress?.({ phase: "planning", tool });
        }
      }
    }

    const artifact = await buildPlanArtifact(intent, accumulator);

    config.onProgress?.({
      phase: "planning",
      planId: artifact.id,
      message: "Plan extracted",
    });

    // minSourceConfidence gate
    if (
      options?.minSourceConfidence !== undefined &&
      artifact.sources.length > 0
    ) {
      const mean =
        artifact.sources.reduce((sum, s) => sum + s.confidence, 0) /
        artifact.sources.length;
      if (mean < options.minSourceConfidence) {
        throw new LowProvenanceError(
          `Plan source confidence ${mean.toFixed(3)} is below required minimum ${options.minSourceConfidence}`,
          options.minSourceConfidence,
          mean,
          artifact.sources.length,
        );
      }
    }

    const meanConfidence =
      artifact.sources.length > 0
        ? artifact.sources.reduce((sum, s) => sum + s.confidence, 0) /
          artifact.sources.length
        : 0.8;

    const tracked = createTrackedResult(artifact, {
      source: "tool" as ResultSource,
      confidence: meanConfidence,
      sourceChain: ["tool" as ResultSource],
      minChainConfidence: meanConfidence,
    });

    return tracked;
  });

  return Object.assign(unit, {
    requireMinChainConfidence(
      threshold: number,
    ): AgentUnit<TrackedResult<PlanArtifact>> {
      return unit.flatMap((innerTracked) => {
        const chainLen = innerTracked.sourceChain?.length ?? 0;
        const mean = chainLen > 0 ? innerTracked.confidence : 0;
        if (mean < threshold) {
          throw new LowProvenanceError(
            `Source chain mean confidence ${mean.toFixed(3)} below required ${threshold}`,
            threshold,
            mean,
            chainLen,
          );
        }
        return AgentUnit.of(innerTracked);
      });
    },
  }) as PlanUnit;
}
