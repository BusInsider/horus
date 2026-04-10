// Swarm Types - Multi-agent orchestration

import { Message } from '../kimi.js';

export interface SubagentConfig {
  id: string;
  role: string;
  description: string;
  systemPrompt: string;
  capabilities: string[]; // Tool names this subagent can use
  maxIterations: number;
  temperature: number;
  parentId?: string; // For hierarchical swarms
}

export interface Subagent {
  config: SubagentConfig;
  status: 'idle' | 'working' | 'completed' | 'failed';
  messages: Message[];
  result?: SubagentResult;
  checkpointId?: string; // Hibernation checkpoint ID
}

export interface SubagentResult {
  success: boolean;
  output: string;
  artifacts?: Record<string, string>; // Generated files/data
  metrics: {
    iterations: number;
    tokensUsed: number;
    executionTime: number;
  };
}

export interface TaskDecomposition {
  objective: string;
  subtasks: Subtask[];
  dependencies: TaskDependency[];
  parallelGroups: string[][]; // Groups of subtask IDs that can run in parallel
}

export interface Subtask {
  id: string;
  description: string;
  role: string;
  priority: number;
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiredCapabilities: string[];
  inputs: string[]; // IDs of other subtasks whose output is needed
}

export interface TaskDependency {
  from: string;
  to: string;
  type: 'data' | 'control';
}

export interface SwarmMessage {
  id: string;
  timestamp: string;
  from: string; // Subagent ID or 'orchestrator'
  to: string; // Subagent ID or 'broadcast'
  type: 'task' | 'result' | 'query' | 'response' | 'coordination';
  payload: unknown;
  priority: number;
}

export interface SwarmState {
  id: string;
  objective: string;
  status: 'planning' | 'executing' | 'coordinating' | 'completed' | 'failed';
  subagents: Map<string, Subagent>;
  messageBus: SwarmMessage[];
  sharedContext: Record<string, unknown>;
  decomposition?: TaskDecomposition;
  createdAt: string;
  updatedAt: string;
}

export interface SwarmResult {
  success: boolean;
  objective: string;
  subagentResults: Map<string, SubagentResult>;
  aggregatedOutput: string;
  metrics: {
    totalSubagents: number;
    totalMessages: number;
    parallelExecutions: number;
    totalExecutionTime: number;
  };
}

export interface OrchestratorStrategy {
  type: 'hierarchical' | 'flat' | 'mesh';
  maxParallelSubagents: number;
  coordinationInterval: number; // How often to coordinate (ms)
  autoMergeResults: boolean;
  conflictResolution: 'orchestrator_decides' | 'voting' | 'priority';
}
