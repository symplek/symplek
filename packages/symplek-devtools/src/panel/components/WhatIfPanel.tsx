import { useWhatIf } from "../hooks/useWhatIf";
import { ComparisonView } from "./ComparisonView";
import type { ExecutionMetrics } from "./MetricsPanel";
import { ScenarioForm } from "./ScenarioForm";
import { ScenarioList } from "./ScenarioList";

interface WhatIfPanelProps {
  currentExecution: ExecutionMetrics;
}

export function WhatIfPanel({ currentExecution }: WhatIfPanelProps) {
  const {
    scenarios,
    comparing,
    createScenario,
    runScenario,
    deleteScenario,
    compareScenarios,
  } = useWhatIf();

  const handleToggleCompare = (id: string) => {
    if (comparing.includes(id)) {
      compareScenarios(comparing.filter((cid) => cid !== id));
    } else {
      compareScenarios([...comparing, id]);
    }
  };

  return (
    <div className="what-if-panel p-4 overflow-y-auto h-full">
      <div className="flex flex-col gap-1 mb-6">
        <h2 className="text-lg font-bold text-zinc-100">Scenario Comparison</h2>
        <p className="text-xs text-zinc-500">
          Simulate changes to model, temperature, and quality levels to optimize
          cost and performance.
        </p>
      </div>

      <ScenarioForm onSubmit={createScenario} />

      <ScenarioList
        scenarios={scenarios}
        comparing={comparing}
        onRun={runScenario}
        onDelete={deleteScenario}
        onCompare={handleToggleCompare}
      />

      {comparing.length > 0 && (
        <ComparisonView
          original={currentExecution}
          scenarios={scenarios.filter((s) => comparing.includes(s.id))}
        />
      )}
    </div>
  );
}
