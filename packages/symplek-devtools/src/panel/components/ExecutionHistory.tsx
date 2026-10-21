import {
  CheckCircle,
  ChevronRight,
  Clock,
  Play,
  Trash2,
  XCircle,
} from "lucide-react";
import type React from "react";
import { usePersistence } from "../hooks/usePersistence";

export const ExecutionHistory: React.FC = () => {
  const { history, isLoading, deleteExecution } = usePersistence();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-zinc-500">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-500 mr-3" />
        Loading history...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-zinc-500 border-2 border-dashed border-zinc-800 rounded-xl m-4">
        <Clock className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-lg font-medium">No execution history</p>
        <p className="text-sm opacity-60">
          Traces will appear here once workflows start.
        </p>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-400" />
          Recent Executions
        </h2>
        <span className="text-xs font-mono text-zinc-500 bg-zinc-900 px-2 py-1 rounded-full border border-zinc-800">
          {history.length} stored
        </span>
      </div>

      <div className="grid gap-3">
        {history.map((execution) => (
          <div
            key={execution.executionId}
            className="group relative overflow-hidden rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 transition-all duration-300 shadow-sm hover:shadow-md"
          >
            {/* Status Indicator Bar */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-1 ${
                execution.status === "complete"
                  ? "bg-emerald-500"
                  : execution.status === "error"
                    ? "bg-rose-500"
                    : "bg-amber-500"
              }`}
            />

            <div className="p-4 flex items-center gap-4">
              <div
                className={`p-2 rounded-lg ${
                  execution.status === "complete"
                    ? "bg-emerald-500/10 text-emerald-500"
                    : execution.status === "error"
                      ? "bg-rose-500/10 text-rose-500"
                      : "bg-amber-500/10 text-amber-500"
                }`}
              >
                {execution.status === "complete" ? (
                  <CheckCircle className="w-5 h-5" />
                ) : execution.status === "error" ? (
                  <XCircle className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 animate-pulse" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-zinc-200 truncate">
                    {execution.workflowName}
                  </h3>
                  <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 uppercase">
                    {execution.executionId.slice(0, 8)}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(execution.startTime)}
                  </span>
                  {execution.endTime && (
                    <span className="flex items-center gap-1">
                      Duration:{" "}
                      {formatDuration(execution.endTime - execution.startTime)}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    Steps: {execution.stepCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => deleteExecution(execution.executionId)}
                  className="p-2 text-zinc-600 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete trace"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
