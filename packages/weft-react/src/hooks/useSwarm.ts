import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentUnit, TrackedResult } from "weft-core";

export interface SwarmRunOptions {
  extensions?: Record<string, unknown>;
}

export interface UseSwarmResult<T> {
  run: (
    units?: AgentUnit<T>[],
    options?: SwarmRunOptions,
  ) => Promise<Array<TrackedResult<T> | null>>;
  results: Array<TrackedResult<T> | null>;
  isRunning: boolean;
  errors: Array<Error | null>;
}

export function useSwarm<T>(
  defaultUnits: AgentUnit<T>[] = [],
): UseSwarmResult<T> {
  const [results, setResults] = useState<Array<TrackedResult<T> | null>>([]);
  const [errors, setErrors] = useState<Array<Error | null>>([]);
  const [isRunning, setIsRunning] = useState(false);

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
      units: AgentUnit<T>[] = defaultUnits,
      options?: SwarmRunOptions,
    ): Promise<Array<TrackedResult<T> | null>> => {
      if (units.length === 0) {
        setErrors([new Error("useSwarm.run requires at least one AgentUnit")]);
        return [];
      }

      abortControllerRef.current?.abort();

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsRunning(true);
      setErrors([]);

      const { createContext } = await import("weft-core");
      const context = createContext({
        signal: controller.signal,
        extensions: options?.extensions,
      });

      try {
        const settled = await Promise.allSettled(
          units.map((unit) => unit.run(context)),
        );

        if (!mountedRef.current || requestIdRef.current !== requestId) {
          return [];
        }

        const nextResults: Array<TrackedResult<T> | null> = settled.map(
          (entry) => (entry.status === "fulfilled" ? entry.value : null),
        );
        const nextErrors: Array<Error | null> = settled.map((entry) => {
          if (entry.status === "fulfilled") {
            return null;
          }
          return entry.reason instanceof Error
            ? entry.reason
            : new Error(String(entry.reason));
        });

        setResults(nextResults);
        setErrors(nextErrors);
        setIsRunning(false);
        return nextResults;
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === "AbortError" ||
            err.message.toLowerCase().includes("abort"))
        ) {
          if (mountedRef.current && requestIdRef.current === requestId) {
            setIsRunning(false);
          }
          return [];
        }
        if (mountedRef.current && requestIdRef.current === requestId) {
          setErrors([err instanceof Error ? err : new Error(String(err))]);
          setIsRunning(false);
        }
        return [];
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [defaultUnits],
  );

  return { run, results, isRunning, errors };
}
