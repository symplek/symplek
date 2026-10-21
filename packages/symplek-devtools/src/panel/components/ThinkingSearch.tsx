export interface ThinkingEntry {
  id: string;
  agentName: string;
  timestamp: number;
  type: "reasoning" | "action" | "observation" | "conclusion";
  content: string;
}

export function ThinkingSearch({
  value,
  onChange,
  onExport,
}: {
  value: string;
  onChange: (val: string) => void;
  onExport: () => void;
}) {
  return (
    <div className="thinking-search">
      <div className="search-input-wrapper">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="Search reasoning..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="search-input"
        />
      </div>
      <button
        type="button"
        onClick={onExport}
        className="export-button"
        title="Export to text"
      >
        <span className="export-icon">📋</span>
        <span>Export</span>
      </button>
    </div>
  );
}
