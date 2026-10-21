import type { ThinkingEntry as ThinkingEntryType } from "./ThinkingSearch";

const AGENT_COLORS: Record<string, string> = {
  architect: "#4ec9b0",
  "code-analyzer": "#ce9178",
  reviewer: "#9cdcfe",
  developer: "#b5cea8",
  researcher: "#dcdcaa",
  default: "#cccccc",
};

const TYPE_ICONS = {
  reasoning: "💭",
  action: "🎯",
  observation: "👁",
  conclusion: "✅",
};

export function ThinkingEntry({ entry }: { entry: ThinkingEntryType }) {
  const date = new Date(entry.timestamp);
  const timeStr = date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const agentColor =
    AGENT_COLORS[entry.agentName.toLowerCase()] || AGENT_COLORS.default;
  const typeIcon = TYPE_ICONS[entry.type];

  return (
    <div className={`thinking-entry type-${entry.type}`}>
      <div className="entry-header">
        <span className="entry-timestamp">[{timeStr}]</span>
        <span className="entry-type-icon" title={entry.type}>
          {typeIcon}
        </span>
        <span className="entry-agent" style={{ color: agentColor }}>
          {entry.agentName}
        </span>
      </div>
      <div className="entry-content">
        <span className="content-prefix">&gt;</span>
        <div className="content-text">{entry.content}</div>
      </div>
    </div>
  );
}
