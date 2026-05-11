export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.005, output: 0.015 },
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rates = MODEL_COSTS[model] || MODEL_COSTS["gpt-4o"];
  return (
    (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output
  );
}

export function formatCost(cost: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(cost);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}
