/**
 * @module AgentUnit/operators/rehearsal
 * @description AgentUnit rehearsal operator extensions (.rehearse(), .replay()).
 *   Deterministic record/replay for testing and regression detection.
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import { RecordingLLMInterceptor } from "../../rehearsal/interceptor";
import { TraceRecorder } from "../../rehearsal/recorder";
import { TraceReplayer } from "../../rehearsal/replayer";
import type {
  ExecutionTrace,
  RecorderOptions,
  RehearsalResult,
  ReplayerOptions,
  ReplayResult,
} from "../../rehearsal/types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.rehearse = function <T>(
  this: AgentUnit<T>,
  options: RecorderOptions = {},
): AgentUnit<RehearsalResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<RehearsalResult<T>>(
    async (ctx) => {
      const recorder = new TraceRecorder(options);
      const agentId = selfMeta.id;
      recorder.setAgentId(agentId);
      recorder.setOperatorChain(selfMeta.operatorChain);

      const llmInterceptor = new RecordingLLMInterceptor({
        includePrompts: options.includePrompts,
        redactPatterns: options.redactPatterns
          ? [...options.redactPatterns]
          : undefined,
      });
      recorder.installInterceptor(llmInterceptor);

      recorder.appendEvent({
        type: "agent_start",
        agentId,
        payload: { agentId, operatorChain: selfMeta.operatorChain },
      });

      try {
        const startTime = Date.now();
        const value = await selfComp(ctx);
        const durationMs = Date.now() - startTime;
        recorder.appendEvent({
          type: "agent_end",
          agentId,
          payload: { agentId, operatorChain: selfMeta.operatorChain },
          durationMs,
        });
        const trace = recorder.finalize(value);
        return { value, trace };
      } finally {
        recorder.uninstallInterceptors();
      }
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "rehearse"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.replay = function <T>(
  this: AgentUnit<T>,
  trace: ExecutionTrace<T>,
  options: ReplayerOptions = {},
): AgentUnit<ReplayResult<T>> {
  const selfMeta = this.getMetadata();
  return AgentUnit._make<ReplayResult<T>>(
    async (_ctx) => {
      const replayer = new TraceReplayer(trace, options);
      const llmInterceptor = replayer.getLLMInterceptor();
      return replayer.replay(async (event) => {
        if (event.type === "llm_call" && llmInterceptor) {
          const payload = event.payload as { model: string; prompt?: string };
          return llmInterceptor.replayCall({
            model: payload.model,
            prompt: payload.prompt ?? "",
          });
        }
        return undefined;
      });
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "replay"],
      createdAt: Date.now(),
    },
  );
};
