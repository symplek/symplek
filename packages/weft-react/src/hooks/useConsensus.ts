import type {
  AgentUnit,
  ConsensusOptions,
  ConsensusResult,
  Vote,
  VoteInput,
} from "@weft/core";
import { useCallback, useEffect, useRef, useState } from "react";

type ConsensusVoter<T> = (
  proposal: T,
) => AgentUnit<VoteInput> | Promise<VoteInput> | VoteInput;

export interface ConsensusRunOptions {
  extensions?: Record<string, unknown>;
}

export interface UseConsensusResult<T> {
  run: (
    proposal: T,
    voters?: Array<ConsensusVoter<T>>,
    options?: ConsensusOptions & ConsensusRunOptions,
  ) => Promise<ConsensusResult | null>;
  result: ConsensusResult | null;
  isRunning: boolean;
  votes: Vote[];
}

export function useConsensus<T>(
  defaultVoters: Array<ConsensusVoter<T>> = [],
  defaultOptions?: ConsensusOptions & ConsensusRunOptions,
): UseConsensusResult<T> {
  const [result, setResult] = useState<ConsensusResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [votes, setVotes] = useState<Vote[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const run = useCallback(
    async (
      proposal: T,
      voters: Array<ConsensusVoter<T>> = defaultVoters,
      options:
        | (ConsensusOptions & ConsensusRunOptions)
        | undefined = defaultOptions,
    ): Promise<ConsensusResult | null> => {
      if (voters.length === 0) {
        return null;
      }

      abortControllerRef.current?.abort();

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsRunning(true);

      try {
        const { AgentUnit, createContext } = await import("@weft/core");
        const unit = AgentUnit.of(proposal).consensus(voters, options);
        const trackedResult = await unit.run(
          createContext({
            signal: controller.signal,
            extensions: options?.extensions,
          }),
        );

        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return null;
        }

        setResult(trackedResult.value);
        setVotes(trackedResult.value.votes);
        setIsRunning(false);
        return trackedResult.value;
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "AbortError" ||
            err.message.toLowerCase().includes("abort"))
        ) {
          if (mountedRef.current && requestIdRef.current === requestId) {
            setIsRunning(false);
          }
          return null;
        }

        if (mountedRef.current && requestIdRef.current === requestId) {
          setIsRunning(false);
        }
        return null;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [defaultOptions, defaultVoters],
  );

  return { run, result, isRunning, votes };
}
