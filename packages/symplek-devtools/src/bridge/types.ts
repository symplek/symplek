export type DevToolsMessage =
  | { type: "SYMPLEK_EXECUTION_START"; payload: ExecutionStartPayload }
  | { type: "SYMPLEK_EXECUTION_STEP"; payload: ExecutionStepPayload }
  | { type: "SYMPLEK_EXECUTION_COMPLETE"; payload: ExecutionCompletePayload }
  | { type: "SYMPLEK_THINKING"; payload: ThinkingPayload }
  | { type: "SYMPLEK_METRICS"; payload: MetricsPayload };

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
  source: "Symplek-page";
  type: DevToolsMessage["type"];
  payload: DevToolsMessage["payload"];
}
