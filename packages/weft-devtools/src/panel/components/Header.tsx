import { Wifi, WifiOff } from "lucide-react";

export function StatusIndicator({
  status,
}: {
  status: "connected" | "disconnected";
}) {
  const isConnected = status === "connected";

  return (
    <div className="status-indicator">
      <div className={`status-dot ${status}`} />
      <span className={isConnected ? "text-success" : "text-error"}>
        {isConnected ? "Connected" : "Disconnected"}
      </span>
      {isConnected ? (
        <Wifi size={12} className="opacity-50" />
      ) : (
        <WifiOff size={12} className="opacity-50" />
      )}
    </div>
  );
}

export function Header({
  connectionStatus,
}: {
  connectionStatus: "connected" | "disconnected";
}) {
  return (
    <header className="header">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 bg-blue-600 rounded-sm flex items-center justify-center">
          <span className="text-[8px] font-bold text-white">K</span>
        </div>
        <h1>Weft DevTools</h1>
      </div>
      <StatusIndicator status={connectionStatus} />
    </header>
  );
}
