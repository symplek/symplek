import { Handle, Position } from "reactflow";

export interface ToolNodeData {
  toolName: string;
  status: "idle" | "running" | "complete" | "error";
  label?: string;
}

export function ToolNode({ data }: { data: ToolNodeData }) {
  return (
    <div
      className={`px-4 py-2 shadow-premium-1 rounded-md border bg-zinc-950 border-zinc-800 min-w-[140px] transition-all duration-300 hover:border-zinc-600 ${data.status === "running" ? "border-amber-500/50" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-2 h-2 !bg-zinc-700"
      />

      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded bg-zinc-800 text-sm">
          🔧
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-medium text-zinc-500 truncate uppercase tracking-tighter">
            Tool Call
          </div>
          <div className="text-xs font-bold text-zinc-200 truncate">
            {data.toolName}
          </div>
        </div>
        {data.status === "running" && (
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2 h-2 !bg-zinc-700"
      />
    </div>
  );
}
