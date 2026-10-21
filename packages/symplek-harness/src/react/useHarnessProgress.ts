/**
 * @module useHarnessProgress
 * @description React hook for accumulating HarnessProgressEvent stream into typed state accessors.
 * Designed for UIs that need to show real-time phase/tool progress as @symplek/harness operators
 * execute. Pairs with HarnessConfig.onProgress or ExecuteOptions.onProgress callbacks.
 * @rules @.cursor/rules/patterns/029-file-header-contracts.mdc
 */

import { useCallback, useState } from "react";
import type {
  ConsensusVote,
  HarnessPhase,
  HarnessProgressEvent,
} from "../types";

export interface UseHarnessProgressResult {
  events: HarnessProgressEvent[];
  currentPhase: HarnessPhase;
  lastTool: string | null;
  lastVotes: ConsensusVote[];
  reset: () => void;
  onProgress: (event: HarnessProgressEvent) => void;
}

export function useHarnessProgress(): UseHarnessProgressResult {
  const [events, setEvents] = useState<HarnessProgressEvent[]>([]);

  const onProgress = useCallback((event: HarnessProgressEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  const reset = useCallback(() => setEvents([]), []);

  const currentPhase: HarnessPhase =
    events.length > 0 ? events[events.length - 1].phase : "planning";

  const lastTool =
    [...events].reverse().find((e) => e.tool !== undefined)?.tool ?? null;

  const lastVotes: ConsensusVote[] =
    [...events].reverse().find((e) => e.votes !== undefined)?.votes ?? [];

  return { events, currentPhase, lastTool, lastVotes, reset, onProgress };
}
