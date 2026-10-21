import { Clock, DollarSign, Terminal } from "lucide-react";

interface ExecutionInfo {
  type: string;
  duration: string;
  cost: string;
}

export function StatusBar({ execution }: { execution?: ExecutionInfo }) {
  if (!execution) {
    return (
      <footer className="status-bar">
        <div className="status-item">
          <span>Ready</span>
        </div>
      </footer>
    );
  }

  return (
    <footer className="status-bar">
      <div className="status-item">
        <Terminal size={12} />
        <span>Execution:</span>
        <strong>{execution.type}</strong>
      </div>
      <div className="status-item">
        <Clock size={12} />
        <span>Duration:</span>
        <strong>{execution.duration}</strong>
      </div>
      <div className="status-item">
        <DollarSign size={12} />
        <span>Cost:</span>
        <strong>{execution.cost}</strong>
      </div>
    </footer>
  );
}
