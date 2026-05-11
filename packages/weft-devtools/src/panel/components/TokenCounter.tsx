import { formatNumber } from "../utils/costs";

interface TokenCounterProps {
  input: number;
  output: number;
  total: number;
}

export function TokenCounter({ input, output, total }: TokenCounterProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-lg font-semibold text-zinc-100">
        {formatNumber(total)}{" "}
        <span className="text-xs font-normal text-zinc-500 uppercase tracking-wider">
          tokens
        </span>
      </div>
      <div className="text-[10px] text-zinc-500 font-mono">
        IN: {formatNumber(input)} | OUT: {formatNumber(output)}
      </div>
    </div>
  );
}
