import { AgentBreakdown, type AgentMetric } from "./AgentBreakdown";
import { CostEstimator } from "./CostEstimator";
import { TokenCounter } from "./TokenCounter";

export interface ExecutionMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  durationMs: number;
  agentBreakdown: AgentMetric[];
}

interface MetricsPanelProps {
  metrics: ExecutionMetrics;
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  return (
    <div className="metrics-panel animate-in fade-in duration-300">
      <div className="grid grid-cols-3 gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm shadow-premium-1">
        <TokenCounter
          input={metrics.inputTokens}
          output={metrics.outputTokens}
          total={metrics.totalTokens}
        />
        <CostEstimator cost={metrics.estimatedCost} />
        <div className="flex flex-col gap-1">
          <div className="text-lg font-semibold text-zinc-100">
            {(metrics.durationMs / 1000).toFixed(2)}s
          </div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Total Duration
          </div>
        </div>
      </div>

      <AgentBreakdown agents={metrics.agentBreakdown} />
    </div>
  );
}
