import type { ExecutionStep } from "../hooks/useTimeTravel";

interface StepDescriptionProps {
  step?: ExecutionStep;
}

export function StepDescription({ step }: StepDescriptionProps) {
  if (!step)
    return <div className="step-description empty">No step selected</div>;

  const getIcon = () => {
    switch (step.type) {
      case "agent_start":
        return "🤖";
      case "agent_end":
        return "✅";
      case "tool_call":
        return "🛠️";
      case "thinking":
        return "🧠";
      case "complete":
        return "🏁";
      case "error":
        return "❌";
      default:
        return "•";
    }
  };

  const getTime = () => {
    return new Date(step.timestamp).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  };

  return (
    <div className="step-description">
      <div className="step-info-header">
        <span className="step-icon">{getIcon()}</span>
        <span className="step-type">{step.type.replace("_", " ")}</span>
        <span className="step-time">{getTime()}</span>
      </div>
      <div className="step-details">
        {step.agentName && (
          <span className="step-agent">agent: {step.agentName}</span>
        )}
        {step.data != null && (
          <pre className="step-data-preview">
            {(() => {
              const json = JSON.stringify(step.data, null, 2);
              return json.length > 100 ? `${json.slice(0, 100)}...` : json;
            })()}
          </pre>
        )}
      </div>
    </div>
  );
}
