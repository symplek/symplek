import { useCallback, useEffect, useState } from "react";

export interface ExecutionStep {
  stepId: string;
  timestamp: number;
  type:
    | "agent_start"
    | "agent_end"
    | "tool_call"
    | "thinking"
    | "complete"
    | "error";
  agentName?: string;
  data: unknown;
}

export function useTimeTravel() {
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);

  const goToStep = useCallback((index: number) => {
    setSteps((prev) => {
      const newIndex = Math.max(0, Math.min(index, prev.length - 1));
      setCurrentStep(newIndex);
      return prev;
    });
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const goForward = useCallback(() => {
    setCurrentStep((prev) => Math.min(steps.length - 1, prev + 1));
  }, [steps.length]);

  const addStep = useCallback(
    (step: ExecutionStep) => {
      setSteps((prev) => {
        const newSteps = [...prev, step];
        // If we were at the end, stay at the end
        if (currentStep === prev.length - 1 || prev.length === 0) {
          setCurrentStep(newSteps.length - 1);
        }
        return newSteps;
      });
    },
    [currentStep],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        goBack();
      } else if (e.key === "ArrowRight") {
        goForward();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goBack, goForward]);

  return {
    steps,
    currentStep,
    currentStepData: steps[currentStep],
    goToStep,
    goBack,
    goForward,
    isAtStart: currentStep === 0,
    isAtEnd: currentStep === steps.length - 1 || steps.length === 0,
    addStep,
    setSteps,
  };
}
