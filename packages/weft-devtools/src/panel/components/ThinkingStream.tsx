import { useEffect, useRef, useState } from "react";
import { ThinkingEntry } from "./ThinkingEntry";
import {
  type ThinkingEntry as ThinkingEntryType,
  ThinkingSearch,
} from "./ThinkingSearch";

export function ThinkingStream({ entries }: { entries: ThinkingEntryType[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;
    setAutoScroll(isAtBottom);
  };

  const filtered = entries.filter(
    (e) =>
      e.content.toLowerCase().includes(filter.toLowerCase()) ||
      e.agentName.toLowerCase().includes(filter.toLowerCase()),
  );

  const handleExport = () => {
    const text = filtered
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        return `[${time}] ${e.agentName} (${e.type}): ${e.content}`;
      })
      .join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thinking-stream-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="thinking-stream">
      <ThinkingSearch
        value={filter}
        onChange={setFilter}
        onExport={handleExport}
      />
      <div
        ref={containerRef}
        className="entries-container"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="empty-state">No entries found</div>
        ) : (
          filtered.map((entry) => (
            <ThinkingEntry key={entry.id} entry={entry} />
          ))
        )}
      </div>
      {entries.length > filtered.length && (
        <div className="filter-status">
          Showing {filtered.length} of {entries.length} entries
        </div>
      )}
    </div>
  );
}
