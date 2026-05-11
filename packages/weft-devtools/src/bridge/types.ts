export type DevToolsMessage =
  | { type: "Weft_EXECUTION_START"; payload: ExecutionStartPayload }
  | { type: "Weft_EXECUTION_STEP"; payload: ExecutionStepPayload }
  | { type: "Weft_EXECUTION_COMPLETE"; payload: ExecutionCompletePayload }
  | { type: "Weft_THINKING"; payload: ThinkingPayload }
  | { type: "Weft_METRICS"; payload: MetricsPayload };

export interface ExecutionStartPayload {
  executionId: string;
  workflowName: string;
  timestamp: number;
}

export interface ExecutionStepPayload {
  executionId: string;
  stepId: string;
  agentName: string;
  type: "start" | "complete" | "error";
  data?: unknown;
  timestamp: number;
}

export interface ExecutionCompletePayload {
  executionId: string;
  timestamp: number;
  result?: unknown;
  error?: string;
}

export interface ThinkingPayload {
  executionId: string;
  agentName: string;
  thought: string;
  timestamp: number;
}

export interface MetricsPayload {
  executionId: string;
  metrics: {
    duration: number;
    tokenCount?: number;
    cost?: number;
    [key: string]: unknown;
  };
  timestamp: number;
}

export interface BridgeMessage extends Record<string, unknown> {
  source: "Weft-page";
  type: DevToolsMessage["type"];
  payload: DevToolsMessage["payload"];
}
