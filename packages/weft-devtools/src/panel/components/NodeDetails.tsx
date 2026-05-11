import { Clock, Cpu, Info, X } from "lucide-react";

interface NodeDetailsProps {
  node: any;
  onClose: () => void;
}

export function NodeDetails({ node, onClose }: NodeDetailsProps) {
  if (!node) return null;

  const { data } = node;

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-zinc-900/95 backdrop-blur-md border-l border-zinc-800 shadow-2xl z-10 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          <h3 className="font-bold text-zinc-100">Node Details</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-zinc-800 rounded-md transition-colors"
        >
          <X className="w-4 h-4 text-zinc-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
            Identity
          </div>
          <div className="flex items-center gap-3 bg-zinc-800/50 p-3 rounded-lg border border-zinc-800">
            <div className="text-2xl">
              {node.type === "agent" ? "🤖" : "🔧"}
            </div>
            <div>
              <div className="text-sm font-bold text-zinc-100">
                {data.agentName || data.toolName}
              </div>
              <div className="text-xs text-zinc-400 capitalize">
                {node.type}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
            Status
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                data.status === "complete"
                  ? "bg-green-500"
                  : data.status === "running"
                    ? "bg-blue-500 animate-pulse"
                    : data.status === "error"
                      ? "bg-red-500"
                      : "bg-zinc-500"
              }`}
            />
            <span className="text-sm text-zinc-200 capitalize">
              {data.status}
            </span>
          </div>
        </div>

        {data.tokensUsed !== undefined && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
              Performance
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-800/30 p-2 rounded border border-zinc-800/50">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-1">
                  <Cpu className="w-3 h-3" /> TOKENS
                </div>
                <div className="text-sm font-mono text-zinc-200">
                  {data.tokensUsed}
                </div>
              </div>
              <div className="bg-zinc-800/30 p-2 rounded border border-zinc-800/50">
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-1">
                  <Clock className="w-3 h-3" /> LATENCY
                </div>
                <div className="text-sm font-mono text-zinc-200">1.2s</div>
              </div>
            </div>
          </div>
        )}

        {data.data && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">
              Payload
            </div>
            <pre className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-[10px] font-mono text-zinc-400 overflow-x-auto">
              {JSON.stringify(data.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
