// Swarm Module - Multi-agent orchestration

export {
  SubagentConfig,
  Subagent,
  SubagentResult,
  TaskDecomposition,
  Subtask,
  SwarmMessage,
  SwarmState,
  SwarmResult,
  OrchestratorStrategy,
} from './types.js';

export { SwarmOrchestrator, getSwarmOrchestrator } from './orchestrator.js';
export { Subagent as SubagentClass, createSubagent } from './subagent.js';
