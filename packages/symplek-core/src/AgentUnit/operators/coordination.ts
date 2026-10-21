/**
 * @module AgentUnit/operators/coordination
 * @description AgentUnit coordination operator extensions (.consensus(), .converge(),
 *   .debate(), .dialectic(), .coherence(), .solo()).
 * @blast_radius HIGH - All agent operations depend on these operators
 * @status STABLE
 * @runtime node
 * @surface internal
 */

import type { HasVotes } from "../../coherence/types";
import {
  createCoherenceComputation,
  createConsensusComputation,
  createConvergeComputation,
  createDebateComputation,
  createDialecticComputation,
  createSoloComputation,
} from "../../operators";
import type { SoloConfig, SoloResult } from "../../solo/types";
import type {
  AdvisorAgent,
  CoherenceOptions,
  CoherenceResult,
  ConsensusOptions,
  ConsensusResult,
  ConvergentAgent,
  ConvergeOptions,
  ConvergeResult,
  DebateAgent,
  DebateOptions,
  DebateResult,
  DialecticOptions,
  DialecticResult,
  LeaderAgent,
  VoteInput,
} from "../../types";
import type { AgentComputation } from "../AgentUnit";
import { AgentUnit } from "../AgentUnit";

AgentUnit.prototype.consensus = function <T>(
  this: AgentUnit<T>,
  voters: Array<
    (proposal: T) => AgentUnit<VoteInput> | Promise<VoteInput> | VoteInput
  >,
  options?: ConsensusOptions,
): AgentUnit<ConsensusResult> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<ConsensusResult>(
    createConsensusComputation(selfComp, voters, selfMeta, options),
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "consensus"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.converge = function <T>(
  this: AgentUnit<T>,
  agents: Array<ConvergentAgent<T>>,
  options?: ConvergeOptions,
): AgentUnit<ConvergeResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<ConvergeResult<T>>(
    async (ctx) => {
      const initialValue = await selfComp(ctx);
      return createConvergeComputation(
        initialValue,
        agents,
        options ?? {},
      )(ctx);
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "converge"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.debate = function <T>(
  this: AgentUnit<T>,
  agents: Array<DebateAgent<T>>,
  options?: DebateOptions,
): AgentUnit<DebateResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<DebateResult<T>>(
    async (ctx) => {
      const initialValue = await selfComp(ctx);
      return createDebateComputation(initialValue, agents, options ?? {})(ctx);
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "debate"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.dialectic = function <T>(
  this: AgentUnit<T>,
  leader: LeaderAgent<T>,
  advisors: Array<AdvisorAgent<T>>,
  options?: DialecticOptions,
): AgentUnit<DialecticResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<DialecticResult<T>>(
    async (ctx) => {
      const problem = await selfComp(ctx);
      return createDialecticComputation(
        problem,
        leader,
        advisors,
        options ?? {},
      )(ctx);
    },
    {
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "dialectic"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.coherence = function <T extends HasVotes>(
  this: AgentUnit<T>,
  options: CoherenceOptions = {},
): AgentUnit<CoherenceResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<CoherenceResult<T>>(
    createCoherenceComputation(selfComp, selfMeta, options),
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "coherence"],
      createdAt: Date.now(),
    },
  );
};

AgentUnit.prototype.solo = function <T>(
  this: AgentUnit<T>,
  config: SoloConfig = {},
): AgentUnit<SoloResult<T>> {
  const selfComp = (this as unknown as { computation: AgentComputation<T> })
    .computation;
  const selfMeta = this.getMetadata();
  return AgentUnit._make<SoloResult<T>>(
    createSoloComputation(selfComp, selfMeta, config),
    {
      ...selfMeta,
      id: AgentUnit._generateId(),
      operatorChain: [...selfMeta.operatorChain, "solo"],
      createdAt: Date.now(),
    },
  );
};
