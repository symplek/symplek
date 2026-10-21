interface StepSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  steps: any[];
}

export function StepSlider({
  min,
  max,
  value,
  onChange,
  steps,
}: StepSliderProps) {
  return (
    <div className="step-slider-container">
      <div className="step-slider-track">
        {steps.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`step-tick ${index <= value ? "active" : ""} ${index === value ? "current" : ""}`}
            onClick={() => onChange(index)}
          />
        ))}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="step-slider-input"
      />
    </div>
  );
}
