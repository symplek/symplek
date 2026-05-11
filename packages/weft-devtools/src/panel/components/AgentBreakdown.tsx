import { formatCost, formatNumber } from "../utils/costs";

export interface AgentMetric {
  name: string;
  tokens: number;
  cost: number;
  latency: string;
  model: string;
}

interface AgentBreakdownProps {
  agents: AgentMetric[];
}

export function AgentBreakdown({ agents }: AgentBreakdownProps) {
  return (
    <div className="mt-6">
      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">
        Agent Breakdown
      </h3>
      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-bottom border-zinc-800 bg-zinc-800/30">
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Agent
              </th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider text-right">
                Tokens
              </th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider text-right">
                Cost
              </th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider text-right">
                Latency
              </th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Model
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {agents.map((agent) => (
              <tr
                key={agent.name}
                className="hover:bg-zinc-800/20 transition-colors"
              >
                <td className="px-3 py-2 font-mono text-zinc-300">
                  {agent.name}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  {formatNumber(agent.tokens)}
                </td>
                <td className="px-3 py-2 text-right text-emerald-500/80">
                  {formatCost(agent.cost)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  {agent.latency}
                </td>
                <td className="px-3 py-2">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400 border border-zinc-700">
                    {agent.model}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
