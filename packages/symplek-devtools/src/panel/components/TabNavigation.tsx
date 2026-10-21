import {
  BarChart,
  Brain,
  Clock,
  FlaskConical,
  type LucideIcon,
  Network,
} from "lucide-react";

export type TabId = "graph" | "metrics" | "thinking" | "history" | "what-if";

interface TabProps {
  id: TabId;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  onClick: (id: TabId) => void;
}

function Tab({ id, icon: Icon, label, isActive, onClick }: TabProps) {
  return (
    <button
      type="button"
      className={`tab-item ${isActive ? "active" : ""}`}
      onClick={() => onClick(id)}
      title={label}
      aria-label={label}
    >
      <Icon size={20} />
    </button>
  );
}

export function TabNavigation({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId;
  onTabChange: (id: TabId) => void;
}) {
  return (
    <nav className="tab-nav">
      <Tab
        id="graph"
        icon={Network}
        label="Graph"
        isActive={activeTab === "graph"}
        onClick={onTabChange}
      />
      <Tab
        id="metrics"
        icon={BarChart}
        label="Metrics"
        isActive={activeTab === "metrics"}
        onClick={onTabChange}
      />
      <Tab
        id="thinking"
        icon={Brain}
        label="Thinking"
        isActive={activeTab === "thinking"}
        onClick={onTabChange}
      />
      <Tab
        id="history"
        icon={Clock}
        label="History"
        isActive={activeTab === "history"}
        onClick={onTabChange}
      />
      <Tab
        id="what-if"
        icon={FlaskConical}
        label="What-If"
        isActive={activeTab === "what-if"}
        onClick={onTabChange}
      />
    </nav>
  );
}
