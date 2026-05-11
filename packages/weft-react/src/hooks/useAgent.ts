import type { AgentUnit, TrackedResult } from "@weft/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentRunOptions {
  extensions?: Record<string, unknown>;
}

export interface UseAgentResult<T> {
  run: (
    unit?: AgentUnit<T>,
    options?: AgentRunOptions,
  ) => Promise<TrackedResult<T> | null>;
  result: TrackedResult<T> | null;
  isRunning: boolean;
  error: Error | null;
}

export function useAgent<T>(defaultUnit?: AgentUnit<T>): UseAgentResult<T> {
  const [result, setResult] = useState<TrackedResult<T> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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
      unit?: AgentUnit<T>,
      options?: AgentRunOptions,
    ): Promise<TrackedResult<T> | null> => {
      const activeUnit = unit ?? defaultUnit;
      if (!activeUnit) {
        setError(new Error("useAgent.run requires an AgentUnit"));
        return null;
      }

      abortControllerRef.current?.abort();

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsRunning(true);
      setError(null);

      try {
        const { createContext } = await import("@weft/core");
        const trackedResult = await activeUnit.run(
          createContext({
            signal: controller.signal,
            extensions: options?.extensions,
          }),
        );

        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return null;
        }

        setResult(trackedResult);
        setIsRunning(false);
        return trackedResult;
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

        const errorObj = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current && requestIdRef.current === requestId) {
          setError(errorObj);
          setIsRunning(false);
        }
        return null;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [defaultUnit],
  );

  return { run, result, isRunning, error };
}
