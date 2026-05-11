/**
 * @module AgentUnit/operators/interview
 * @description AgentUnit interview operator extensions (.interview(), .conduct()).
 *   Human-in-the-loop Q&A operators.
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import {
  createConductComputation,
  createInterviewComputation,
} from "../../interview/computations";
import { Interview } from "../../interview/Interview";
import type {
  InterviewConfig,
  InterviewHandlers,
  InterviewPending,
  InterviewResult,
} from "../../interview/types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.interview = function <T, TContext>(
  this: AgentUnit<T>,
  config: InterviewConfig<TContext>,
): AgentUnit<InterviewPending<TContext>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<InterviewPending<TContext>>(
    async (ctx) => {
      const inputValue = await selfComp(ctx);
      const initialInput = String(inputValue);
      const interview = Interview.create(config);
      return createInterviewComputation(initialInput, interview, selfMeta)(ctx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "interview"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.conduct = function <TContext>(
  this: AgentUnit<InterviewPending<TContext>>,
  handlers: InterviewHandlers,
): AgentUnit<InterviewResult<TContext>> {
  const selfComp = (
    this as unknown as {
      computation: AgentComputation<InterviewPending<TContext>>;
    }
  ).computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<InterviewResult<TContext>>(
    async (ctx) => {
      const pending = await selfComp(ctx);
      return createConductComputation(pending, handlers, selfMeta)(ctx);
    },
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "conduct"],
      createdAt: Date.now(),
    },
  );
};
