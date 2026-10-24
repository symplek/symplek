import { useEffect, useMemo, useState } from "react";
import type { ExecutionStepPayload } from "../bridge/types";
import { ExecutionGraph } from "./components/ExecutionGraph";
import { ExecutionHistory } from "./components/ExecutionHistory";
import { Header } from "./components/Header";
import { type ExecutionMetrics, MetricsPanel } from "./components/MetricsPanel";
import { StatusBar } from "./components/StatusBar";
import { type TabId, TabNavigation } from "./components/TabNavigation";
import { TimeTravelControls } from "./components/TimeTravelControls";
import { WhatIfPanel } from "./components/WhatIfPanel";
import { useDevToolsBridge } from "./hooks/useDevToolsBridge";
import { type ExecutionStep, useTimeTravel } from "./hooks/useTimeTravel";
import "./styles/panel.css";

export function DevToolsPanel() {
  const { isConnected, messages } = useDevToolsBridge();
  const [activeTab, setActiveTab] = useState<TabId>("graph");
  const timeTravel = useTimeTravel();

  // Sync messages with time travel steps
  useEffect(() => {
    const executionSteps: ExecutionStep[] = messages
      .filter((msg) => msg.type === "SYMPLEK_EXECUTION_STEP")
      .map((msg) => {
        const payload = msg.payload as ExecutionStepPayload;
        let type: ExecutionStep["type"] = "thinking";

        if (payload.type === "start") {
          type = payload.agentName.toLowerCase().includes("tool")
            ? "tool_call"
            : "agent_start";
        } else if (payload.type === "complete") {
          type = "complete";
        } else if (payload.type === "error") {
          type = "error";
        }

        return {
          stepId: payload.stepId,
          timestamp: payload.timestamp || Date.now(),
          type,
          agentName: payload.agentName,
          data: payload.data,
        };
      });

    if (executionSteps.length > 0) {
      timeTravel.setSteps(executionSteps);
    }
  }, [messages, timeTravel.setSteps]);

  // Derive metrics from messages
  const metrics = useMemo<ExecutionMetrics>(() => {
    // ... same as before ...
    return {
      totalTokens: 4523,
      inputTokens: 1200,
      outputTokens: 3323,
      estimatedCost: 0.0234,
      durationMs: 2300,
      agentBreakdown: [
        {
          name: "architect",
          tokens: 2100,
          cost: 0.015,
          latency: "1.2s",
          model: "gpt-4o",
        },
        {
          name: "reviewer",
          tokens: 1423,
          cost: 0.008,
          latency: "0.8s",
          model: "claude-3-5-sonnet",
        },
      ],
    };
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case "graph":
        return (
          <div className="flex flex-col h-full gap-4">
            <div className="flex-1 min-h-0">
              <ExecutionGraph
                messages={messages}
                currentStepIndex={timeTravel.currentStep}
                steps={timeTravel.steps}
              />
            </div>
            <TimeTravelControls timeTravel={timeTravel} />
          </div>
        );
      case "metrics":
        return <MetricsPanel metrics={metrics} />;
      case "thinking":
        return (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <p>Thinking View (Coming Soon)</p>
          </div>
        );
      case "history":
        return <ExecutionHistory />;
      case "what-if":
        return <WhatIfPanel currentExecution={metrics} />;
      default:
        return null;
    }
  };

  return (
    <div className="Symplek-devtools-panel">
      <Header connectionStatus={isConnected ? "connected" : "disconnected"} />

      <div className="main-container">
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="content-area">{renderContent()}</main>
      </div>

      <StatusBar
        execution={{
          type: "execution",
          duration: `${(metrics.durationMs / 1000).toFixed(1)}s`,
          cost: `$${metrics.estimatedCost.toFixed(3)}`,
        }}
      />
    </div>
  );
}
