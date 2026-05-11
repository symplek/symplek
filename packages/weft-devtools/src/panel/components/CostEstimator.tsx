import { formatCost } from "../utils/costs";

interface CostEstimatorProps {
  cost: number;
}

export function CostEstimator({ cost }: CostEstimatorProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-lg font-semibold text-emerald-400">
        {formatCost(cost)}
      </div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
        Estimated Cost
      </div>
    </div>
  );
}
