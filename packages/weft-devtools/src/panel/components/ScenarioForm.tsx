import type React from "react";
import { useState } from "react";
import type { WhatIfScenario } from "../hooks/useWhatIf";
import { MODEL_COSTS } from "../utils/costs";

interface ScenarioFormProps {
  onSubmit: (
    name: string,
    modifications: WhatIfScenario["modifications"],
  ) => void;
}

export function ScenarioForm({ onSubmit }: ScenarioFormProps) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [temperature, setTemperature] = useState(0.7);
  const [qualityLevel, setQualityLevel] = useState<
    "quick" | "balanced" | "rigorous"
  >("balanced");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onSubmit(name, { model, temperature, qualityLevel });
    setName("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm mb-6"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">
          New What-If Scenario
        </h3>
        <button
          type="submit"
          disabled={!name}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-colors shadow-premium-1"
        >
          Create Scenario
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="scenario-name"
            className="text-[10px] text-zinc-500 uppercase tracking-wider"
          >
            Scenario Name
          </label>
          <input
            id="scenario-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., GPT-4o Mini Optimization"
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="scenario-model"
            className="text-[10px] text-zinc-500 uppercase tracking-wider"
          >
            Model
          </label>
          <select
            id="scenario-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 outline-none"
          >
            {Object.keys(MODEL_COSTS).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="scenario-temperature"
            className="text-[10px] text-zinc-500 uppercase tracking-wider"
          >
            Temperature ({temperature})
          </label>
          <input
            id="scenario-temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
            <legend className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Quality Level
            </legend>
            <div className="flex gap-2">
              {(["quick", "balanced", "rigorous"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setQualityLevel(level)}
                  className={`flex-1 py-1 text-[10px] uppercase rounded border transition-all ${
                    qualityLevel === level
                      ? "bg-blue-600/20 border-blue-500 text-blue-400"
                      : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </form>
  );
}
