import { useCallback, useState } from "react";
import type { ExecutionMetrics } from "../components/MetricsPanel";

export interface WhatIfScenario {
  id: string;
  name: string;
  baseExecutionId: string;
  modifications: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    qualityLevel?: "quick" | "balanced" | "rigorous";
  };
  result?: WhatIfResult;
}

export interface WhatIfResult {
  executionId: string;
  output: unknown;
  metrics: ExecutionMetrics;
  duration: number;
}

export function useWhatIf() {
  const [scenarios, setScenarios] = useState<WhatIfScenario[]>([]);
  const [comparing, setComparing] = useState<string[]>([]);

  const createScenario = useCallback(
    (name: string, modifications: WhatIfScenario["modifications"]) => {
      const newScenario: WhatIfScenario = {
        id: crypto.randomUUID(),
        name,
        baseExecutionId: "current", // Placeholder
        modifications,
      };
      setScenarios((prev) => [...prev, newScenario]);
    },
    [],
  );

  const runScenario = useCallback(async (id: string) => {
    setScenarios((prev) =>
      prev.map((s) => {
        if (s.id === id) {
          // Mock run result for now
          const mockMetrics: ExecutionMetrics = {
            totalTokens: Math.floor(Math.random() * 5000) + 1000,
            inputTokens: 1200,
            outputTokens: Math.floor(Math.random() * 4000) + 500,
            estimatedCost: Math.random() * 0.05,
            durationMs: Math.floor(Math.random() * 3000) + 500,
            agentBreakdown: [],
          };

          return {
            ...s,
            result: {
              executionId: `sim-${id}`,
              output: "Simulated output...",
              metrics: mockMetrics,
              duration: mockMetrics.durationMs / 1000,
            },
          };
        }
        return s;
      }),
    );
  }, []);

  const deleteScenario = useCallback((id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    setComparing((prev) => prev.filter((cid) => cid !== id));
  }, []);

  const compareScenarios = useCallback((ids: string[]) => {
    setComparing(ids);
  }, []);

  return {
    scenarios,
    comparing,
    createScenario,
    runScenario,
    deleteScenario,
    compareScenarios,
  };
}
