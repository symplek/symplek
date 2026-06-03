/**
 * @module weft-core/operators/solo
 * @description Solo operator: executes solo action with lock acquisition and safety guarantees.
 * @blast_radius MEDIUM
 * @status STABLE
 */

import type { AgentComputation, AgentUnitMetadata } from "../AgentUnit";
import { SOLO_DEFAULTS } from "../solo/config";
import { shouldActSolo } from "../solo/decision";
import { acquireLock, releaseLock } from "../solo/lock";
import {
  commitTransaction,
  createTransaction,
  rollbackTransaction,
} from "../solo/transactionLog";
// Solo mechanism imports (STORY-02.01)
import type { ExtractedSignals, SoloConfig, SoloResult } from "../solo/types";
import { SoloBlockedError } from "../solo/types";
import type { AgentContext, TrackedResult } from "../types";
import { TRACKED_MARKER } from "../types";

/**
 * Extract confidence, coherence, and risk signals from a value.
 *
 * @param value - The value to extract signals from
 * @returns Extracted signals with source information
 *
 * @remarks
 * Signal extraction priority:
 * 1. Explicit properties on the value (confidence, coherence, riskScore)
 * 2. TrackedResult metadata
 * 3. ConsensusResult/DebateResult/DialecticResult metadata
 * 4. Default values (conservative)
 *
 * 📝 BUILD[STORY-02.03]: Signal extraction for solo decision
 */
export function extractSignals(value: unknown): ExtractedSignals {
  // Default conservative signals
  let confidence = 0.5;
  let coherence = 0.5;
  let riskScore = 0.5;
  let source: ExtractedSignals["source"] = "default";

  if (value === null || value === undefined) {
    return { confidence, coherence, riskScore, source };
  }

  // Check if it's an object we can extract from
  if (typeof value !== "object") {
    return { confidence, coherence, riskScore, source };
  }

  const obj = value as Record<string, unknown>;

  // Check for explicit signals
  if (typeof obj.confidence === "number") {
    confidence = obj.confidence;
    source = "explicit";
  }
  if (typeof obj.coherence === "number") {
    coherence = obj.coherence;
    source = "explicit";
  }
  if (typeof obj.riskScore === "number") {
    riskScore = obj.riskScore;
    source = "explicit";
  }

  // Check for TrackedResult
  if (TRACKED_MARKER in obj) {
    const tracked = obj as unknown as TrackedResult<unknown>;
    if (source === "default") {
      confidence = tracked.confidence;
      source = "inferred";
    }
    // Extract objective confidence if available
    if (tracked.objectiveConfidence) {
      confidence = tracked.objectiveConfidence.composite;
      source = "inferred";
    }
  }

  // Check for multi-agent results with objectiveConfidence
  if (obj.objectiveConfidence && typeof obj.objectiveConfidence === "object") {
    const oc = obj.objectiveConfidence as { composite?: number };
    if (typeof oc.composite === "number") {
      confidence = oc.composite;
      source = "inferred";
    }
  }

  // Check for ConsensusResult
  if (typeof obj.weightedApproval === "number") {
    // Use weightedApproval as a coherence proxy
    if (source === "default" || coherence === 0.5) {
      coherence = obj.weightedApproval as number;
      source = "inferred";
    }
  }

  // Check for CoherenceResult
  if (obj.coherence && typeof obj.coherence === "object") {
    const coh = obj.coherence as { composite?: number };
    if (typeof coh.composite === "number") {
      coherence = coh.composite;
      source = "inferred";
    }
  }

  // Estimate risk based on value characteristics
  // Higher complexity = higher risk
  if (source === "default") {
    // Simple heuristic: larger objects = more complex = higher risk
    const keys = Object.keys(obj);
    riskScore = Math.min(0.5, keys.length * 0.05);
  }

  return { confidence, coherence, riskScore, source };
}

/**
 * Creates a computation that executes solo action with safety guarantees.
 *
 * @param innerComputation - The computation to execute if solo decision passes
 * @param innerMeta - Metadata from the upstream AgentUnit
 * @param config - Solo configuration options
 * @returns A computation that produces SoloResult<T>
 *
 * @remarks
 * Solo execution flow:
 * 1. Execute upstream computation to get value
 * 2. Extract confidence/coherence/risk signals
 * 3. Attempt lock acquisition
 * 4. Make solo decision
 * 5. If approved: create transaction, return result
 * 6. If blocked: release lock, throw SoloBlockedError
 *
 * 📝 BUILD[STORY-02.01]: Solo computation factory
 */
export function createSoloComputation<T>(
  innerComputation: AgentComputation<T>,
  innerMeta: AgentUnitMetadata,
  config: SoloConfig = {},
): AgentComputation<SoloResult<T>> {
  const {
    confidenceThreshold = SOLO_DEFAULTS.confidenceThreshold,
    coherenceThreshold = SOLO_DEFAULTS.coherenceThreshold,
    riskThreshold = SOLO_DEFAULTS.riskThreshold,
    lockTimeout = SOLO_DEFAULTS.lockTimeout,
    resourceId: configResourceId,
    onSoloAction,
    onBlocked,
    onLockAttempt,
    onLockRelease,
  } = config;

  return async (ctx: AgentContext): Promise<SoloResult<T>> => {
    // Step 1: Execute upstream computation
    const value = await innerComputation(ctx);

    // Step 2: Extract signals from value
    const signals = extractSignals(value);

    // Determine resource ID (from config, context, or default)
    const resourceId =
      configResourceId ??
      (ctx.extensions?.resourceId as string | undefined) ??
      `solo_${innerMeta.id}`;

    // Determine agent ID
    const agentId =
      (ctx.extensions?.agentId as string | undefined) ??
      `agent_${innerMeta.id}`;

    // Step 3: Attempt lock acquisition
    if (onLockAttempt) {
      await onLockAttempt(resourceId);
    }

    const lockResult = await acquireLock(resourceId, agentId, lockTimeout);
    const lockAcquired = lockResult.acquired;

    // Step 4: Make solo decision
    const decision = shouldActSolo(
      signals.confidence,
      signals.coherence,
      signals.riskScore,
      lockAcquired,
      {
        confidenceThreshold,
        coherenceThreshold,
        riskThreshold,
      },
    );

    // Step 5/6: Handle decision
    if (!decision.canActSolo) {
      // Release lock if we acquired it
      if (lockAcquired) {
        const released = await releaseLock(resourceId, agentId);
        if (onLockRelease) {
          await onLockRelease(resourceId, released);
        }
      }

      // Invoke blocked callback
      if (onBlocked) {
        await onBlocked(decision);
      }

      // Throw error
      throw new SoloBlockedError(decision);
    }

    // Solo approved - create transaction
    const txn = createTransaction(agentId, "solo", {
      resourceId,
      signals,
      operatorChain: innerMeta.operatorChain,
    });

    try {
      // Invoke success callback
      if (onSoloAction) {
        await onSoloAction(decision);
      }

      // Commit transaction
      commitTransaction(txn.id, value);

      // Build result
      const result: SoloResult<T> = {
        value,
        decision,
        transactionId: txn.id,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      // Rollback transaction on error
      rollbackTransaction(
        txn.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      // Always release lock
      const released = await releaseLock(resourceId, agentId);
      if (onLockRelease) {
        await onLockRelease(resourceId, released);
      }
    }
  };
}
