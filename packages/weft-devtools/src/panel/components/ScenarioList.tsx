import type { WhatIfScenario } from "../hooks/useWhatIf";
import { formatCost } from "../utils/costs";

interface ScenarioListProps {
  scenarios: WhatIfScenario[];
  comparing: string[];
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onCompare: (id: string) => void;
}

export function ScenarioList({
  scenarios,
  comparing,
  onRun,
  onDelete,
  onCompare,
}: ScenarioListProps) {
  if (scenarios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-800 rounded-xl text-zinc-500">
        <p className="text-xs">No scenarios created yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
        Active Scenarios
      </h3>
      {scenarios.map((scenario) => (
        <div
          key={scenario.id}
          className="group flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/40 transition-all"
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-200">
                {scenario.name}
              </span>
              {scenario.result && (
                <span className="text-[9px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded border border-green-500/20">
                  Ready
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500">
              {scenario.modifications.model} • Temp:{" "}
              {scenario.modifications.temperature} •{" "}
              {scenario.modifications.qualityLevel}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {scenario.result ? (
              <div className="flex items-center gap-4 mr-4">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-zinc-400">
                    {formatCost(scenario.result.metrics.estimatedCost)}
                  </span>
                  <span className="text-[8px] text-zinc-600 uppercase">
                    Cost
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-zinc-400">
                    {scenario.result.duration.toFixed(1)}s
                  </span>
                  <span className="text-[8px] text-zinc-600 uppercase">
                    Dur
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onRun(scenario.id)}
                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded transition-colors"
              >
                Run Simulation
              </button>
            )}

            <div className="flex items-center gap-1 border-l border-zinc-800 pl-2">
              <button
                type="button"
                onClick={() => onCompare(scenario.id)}
                disabled={!scenario.result}
                className={`p-1.5 rounded transition-colors ${
                  comparing.includes(scenario.id)
                    ? "text-blue-400 bg-blue-500/10"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                }`}
                title="Compare"
                aria-label="Compare"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onDelete(scenario.id)}
                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Delete"
                aria-label="Delete"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
