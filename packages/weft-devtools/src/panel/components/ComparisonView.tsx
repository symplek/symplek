import type { WhatIfScenario } from "../hooks/useWhatIf";
import { formatCost, formatNumber } from "../utils/costs";
import type { ExecutionMetrics } from "./MetricsPanel";

interface ComparisonViewProps {
  original: ExecutionMetrics;
  scenarios: WhatIfScenario[];
}

export function ComparisonView({ original, scenarios }: ComparisonViewProps) {
  const renderDiff = (current: number, base: number, isCost = false) => {
    const diff = current - base;
    const percent = (diff / base) * 100;
    const isBetter = diff < 0;

    if (Math.abs(percent) < 0.1) return null;

    return (
      <span
        className={`text-[9px] font-medium ml-1.5 ${isBetter ? "text-green-400" : "text-red-400"}`}
      >
        ({percent > 0 ? "+" : ""}
        {percent.toFixed(1)}%)
        {isBetter && (isCost ? " 💰" : " ⚡")}
      </span>
    );
  };

  return (
    <div className="mt-8 border-t border-zinc-800 pt-6 animate-in slide-in-from-bottom-4 duration-500">
      <h3 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider mb-4">
        What-If Comparison
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-4 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                Metric
              </th>
              <th className="text-left py-2 px-4 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800 bg-zinc-900/40">
                Original
              </th>
              {scenarios.map((s) => (
                <th
                  key={s.id}
                  className="text-left py-2 px-4 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800"
                >
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-3 px-4 text-xs text-zinc-400 border-b border-zinc-800/50">
                Model
              </td>
              <td className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50 bg-zinc-900/40 font-mono">
                gpt-4o
              </td>
              {scenarios.map((s) => (
                <td
                  key={s.id}
                  className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50 font-mono"
                >
                  {s.modifications.model}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-3 px-4 text-xs text-zinc-400 border-b border-zinc-800/50">
                Tokens
              </td>
              <td className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50 bg-zinc-900/40">
                {formatNumber(original.totalTokens)}
              </td>
              {scenarios.map((s) => (
                <td
                  key={s.id}
                  className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50"
                >
                  {formatNumber(s.result?.metrics.totalTokens || 0)}
                  {s.result &&
                    renderDiff(
                      s.result.metrics.totalTokens,
                      original.totalTokens,
                    )}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-3 px-4 text-xs text-zinc-400 border-b border-zinc-800/50">
                Cost
              </td>
              <td className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50 bg-zinc-900/40">
                {formatCost(original.estimatedCost)}
              </td>
              {scenarios.map((s) => (
                <td
                  key={s.id}
                  className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50"
                >
                  {formatCost(s.result?.metrics.estimatedCost || 0)}
                  {s.result &&
                    renderDiff(
                      s.result.metrics.estimatedCost,
                      original.estimatedCost,
                      true,
                    )}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-3 px-4 text-xs text-zinc-400 border-b border-zinc-800/50">
                Duration
              </td>
              <td className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50 bg-zinc-900/40">
                {(original.durationMs / 1000).toFixed(2)}s
              </td>
              {scenarios.map((s) => (
                <td
                  key={s.id}
                  className="py-3 px-4 text-xs text-zinc-200 border-b border-zinc-800/50"
                >
                  {(s.result?.duration || 0).toFixed(2)}s
                  {s.result &&
                    renderDiff(s.result.duration * 1000, original.durationMs)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="py-3 px-4 text-xs text-zinc-400">Output</td>
              <td className="py-3 px-4 text-[10px] text-zinc-500 italic bg-zinc-900/40">
                "The code has 3..."
              </td>
              {scenarios.map((s) => (
                <td
                  key={s.id}
                  className="py-3 px-4 text-[10px] text-zinc-500 italic"
                >
                  "Found 3 issues..."
                  <span className="ml-2 text-[8px] px-1 bg-zinc-800 text-zinc-400 rounded">
                    SIMILAR
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
