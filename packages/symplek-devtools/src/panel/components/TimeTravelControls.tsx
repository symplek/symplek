import type { useTimeTravel } from "../hooks/useTimeTravel";
import { StepDescription } from "./StepDescription";
import { StepSlider } from "./StepSlider";

interface TimeTravelControlsProps {
  timeTravel: ReturnType<typeof useTimeTravel>;
}

export function TimeTravelControls({ timeTravel }: TimeTravelControlsProps) {
  const {
    steps,
    currentStep,
    goToStep,
    goBack,
    goForward,
    isAtStart,
    isAtEnd,
  } = timeTravel;

  if (steps.length === 0) return null;

  return (
    <div className="time-travel-controls shadow-premium-1">
      <div className="controls-row">
        <div className="button-group">
          <button
            type="button"
            className="control-btn"
            onClick={() => goToStep(0)}
            disabled={isAtStart}
            title="First Step"
          >
            ◀◀
          </button>
          <button
            type="button"
            className="control-btn"
            onClick={goBack}
            disabled={isAtStart}
            title="Previous Step"
          >
            ◀
          </button>
        </div>

        <div className="step-counter">
          Step <span className="current">{currentStep + 1}</span> of{" "}
          <span className="total">{steps.length}</span>
        </div>

        <div className="button-group">
          <button
            type="button"
            className="control-btn"
            onClick={goForward}
            disabled={isAtEnd}
            title="Next Step"
          >
            ▶
          </button>
          <button
            type="button"
            className="control-btn"
            onClick={() => goToStep(steps.length - 1)}
            disabled={isAtEnd}
            title="Last Step"
          >
            ▶▶
          </button>
        </div>

        <button type="button" className="compare-btn ml-auto">
          Compare
        </button>
      </div>

      <StepSlider
        min={0}
        max={steps.length - 1}
        value={currentStep}
        onChange={goToStep}
        steps={steps}
      />

      <StepDescription step={steps[currentStep]} />
    </div>
  );
}
