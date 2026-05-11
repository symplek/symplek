import { CheckCircle2, Loader2, PlayCircle, XCircle } from "lucide-react";
import { Handle, Position } from "reactflow";

export interface AgentNodeData {
  agentName: string;
  status: "idle" | "running" | "complete" | "error";
  tokensUsed?: number;
  label?: string;
}

export function AgentNode({ data }: { data: AgentNodeData }) {
  const getStatusIcon = () => {
    switch (data.status) {
      case "running":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case "complete":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <PlayCircle className="w-4 h-4 text-zinc-400" />;
    }
  };

  return (
    <div
      className={`px-4 py-3 shadow-premium-1 rounded-lg border bg-zinc-900 border-zinc-800 min-w-[160px] transition-all duration-300 hover:border-zinc-600 ${data.status === "running" ? "ring-1 ring-blue-500/50" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-zinc-700"
      />

      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 text-lg">
          🤖
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-zinc-400 truncate">
            Agent
          </div>
          <div className="text-sm font-bold text-zinc-100 truncate">
            {data.agentName}
          </div>
        </div>
        <div className="flex items-center justify-center">
          {getStatusIcon()}
        </div>
      </div>

      {data.tokensUsed !== undefined && (
        <div className="mt-2 pt-2 border-t border-zinc-800 flex justify-between items-center">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Tokens
          </span>
          <span className="text-[10px] font-mono text-zinc-300">
            {data.tokensUsed}
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-zinc-700"
      />
    </div>
  );
}
