import { useCallback, useEffect, useState } from "react";
import {
  type ExecutionStep,
  persistence,
  type StoredExecution,
} from "../../services/persistence";

export function usePersistence() {
  const [history, setHistory] = useState<StoredExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshHistory = useCallback(async () => {
    try {
      const recent = await persistence.getRecentExecutions();
      setHistory(recent);
    } catch (error) {
      console.error("Failed to refresh history:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    persistence.init().then(refreshHistory);
  }, [refreshHistory]);

  const saveExecution = async (execution: StoredExecution) => {
    await persistence.saveExecution(execution);
    await refreshHistory();
  };

  const deleteExecution = async (executionId: string) => {
    await persistence.deleteExecution(executionId);
    await refreshHistory();
  };

  const getSteps = async (executionId: string): Promise<ExecutionStep[]> => {
    return persistence.getStepsForExecution(executionId);
  };

  return {
    history,
    isLoading,
    refreshHistory,
    saveExecution,
    deleteExecution,
    getSteps,
  };
}
