// Swarm Orchestrator - Multi-agent coordination
// PARL-inspired: Planning, Acting, Reflecting, Learning

import { randomUUID } from 'crypto';
import { KimiClient } from '../kimi.js';
import { HibernationManager } from '../hibernation.js';
import {
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

const DEFAULT_STRATEGY: OrchestratorStrategy = {
  type: 'hierarchical',
  maxParallelSubagents: 5,
  coordinationInterval: 1000,
  autoMergeResults: true,
  conflictResolution: 'orchestrator_decides',
};

export class SwarmOrchestrator {
  private kimi: KimiClient;
  // @ts-expect-error Reserved for future swarm checkpointing feature
  private _hibernation: HibernationManager;

  private strategy: OrchestratorStrategy;
  private state: SwarmState;
  private messageHandlers: Map<string, ((message: SwarmMessage) => void)[]> = new Map();

  constructor(
    kimi: KimiClient,
    hibernation: HibernationManager,
    strategy: Partial<OrchestratorStrategy> = {}
  ) {
    this.kimi = kimi;
    this._hibernation = hibernation;
    this.strategy = { ...DEFAULT_STRATEGY, ...strategy };
    this.state = this.createInitialState();
  }

  private createInitialState(): SwarmState {
    return {
      id: `swarm_${randomUUID().slice(0, 8)}`,
      objective: '',
      status: 'planning',
      subagents: new Map(),
      messageBus: [],
      sharedContext: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Main entry point: Execute a complex objective using multiple agents
  async execute(objective: string): Promise<SwarmResult> {
    this.state.objective = objective;
    const startTime = Date.now();

    // Phase 1: Planning - Decompose task into subtasks
    this.state.status = 'planning';
    const decomposition = await this.decomposeTask(objective);
    this.state.decomposition = decomposition;

    // Phase 2: Acting - Spawn subagents and execute in parallel groups
    this.state.status = 'executing';
    await this.executeSubtasks(decomposition);

    // Phase 3: Reflecting - Coordinate and resolve conflicts
    this.state.status = 'coordinating';
    await this.coordinateResults();

    // Phase 4: Learning - Aggregate results
    const result = await this.aggregateResults();
    
    this.state.status = result.success ? 'completed' : 'failed';
    this.state.updatedAt = new Date().toISOString();

    return {
      ...result,
      metrics: {
        ...result.metrics,
        totalExecutionTime: Date.now() - startTime,
      },
    };
  }

  // Phase 1: Decompose task using LLM
  private async decomposeTask(objective: string): Promise<TaskDecomposition> {
    const prompt = `You are a task decomposition expert. Break down this objective into subtasks that can be executed by parallel AI agents.

Objective: "${objective}"

Provide your response as JSON:
{
  "subtasks": [
    {
      "id": "task_1",
      "description": "Clear description of what this subtask does",
      "role": "Specialist role (e.g., 'Code Reviewer', 'Researcher', 'Writer')",
      "priority": 1,
      "estimatedComplexity": "low|medium|high",
      "requiredCapabilities": ["view", "search", "bash"],
      "inputs": [] // IDs of tasks this depends on
    }
  ],
  "dependencies": [
    {"from": "task_1", "to": "task_2", "type": "data"}
  ]
}

Guidelines:
- Create 2-8 subtasks depending on complexity
- Identify dependencies clearly
- Group parallelizable tasks
- Assign specialist roles based on required expertise`;

    const response = await this.kimi.complete(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, maxTokens: 4000 }
    );

    try {
      const content = response.choices[0]?.message?.content || '{}';
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      
      // Compute parallel groups from dependencies
      const parallelGroups = this.computeParallelGroups(
        parsed.subtasks,
        parsed.dependencies
      );

      return {
        objective,
        subtasks: parsed.subtasks,
        dependencies: parsed.dependencies,
        parallelGroups,
      };
    } catch (error) {
      // Fallback: Single task decomposition
      return {
        objective,
        subtasks: [{
          id: 'task_1',
          description: objective,
          role: 'Generalist',
          priority: 1,
          estimatedComplexity: 'medium',
          requiredCapabilities: ['view', 'edit', 'bash', 'search'],
          inputs: [],
        }],
        dependencies: [],
        parallelGroups: [['task_1']],
      };
    }
  }

  // Compute which tasks can run in parallel
  private computeParallelGroups(
    subtasks: Subtask[],
    dependencies: { from: string; to: string }[]
  ): string[][] {
    const completed = new Set<string>();
    const groups: string[][] = [];
    const remaining = new Set(subtasks.map(s => s.id));

    while (remaining.size > 0) {
      const group: string[] = [];
      
      for (const taskId of remaining) {
        // Check if all dependencies are satisfied
        const deps = dependencies
          .filter(d => d.to === taskId)
          .map(d => d.from);
        
        const satisfied = deps.every(d => completed.has(d));
        
        if (satisfied) {
          group.push(taskId);
        }
      }

      if (group.length === 0) {
        // Circular dependency, break
        group.push(...remaining);
        groups.push(group);
        break;
      }

      groups.push(group);
      for (const taskId of group) {
        completed.add(taskId);
        remaining.delete(taskId);
      }
    }

    return groups;
  }

  // Phase 2: Execute subtasks in parallel groups
  private async executeSubtasks(decomposition: TaskDecomposition): Promise<void> {
    for (const group of decomposition.parallelGroups) {
      // Limit parallelism based on strategy
      const batchSize = this.strategy.maxParallelSubagents;
      
      for (let i = 0; i < group.length; i += batchSize) {
        const batch = group.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(taskId => this.spawnAndExecuteSubagent(taskId, decomposition))
        );
      }
    }
  }

  // Spawn a subagent and execute its task
  private async spawnAndExecuteSubagent(
    taskId: string,
    decomposition: TaskDecomposition
  ): Promise<void> {
    const subtask = decomposition.subtasks.find(s => s.id === taskId);
    if (!subtask) return;

    // Create subagent config
    const config: SubagentConfig = {
      id: `sub_${randomUUID().slice(0, 8)}`,
      role: subtask.role,
      description: subtask.description,
      systemPrompt: `You are a ${subtask.role}. Your task: ${subtask.description}\n\n` +
        `Required capabilities: ${subtask.requiredCapabilities.join(', ')}`,
      capabilities: subtask.requiredCapabilities,
      maxIterations: subtask.estimatedComplexity === 'high' ? 20 : 
                     subtask.estimatedComplexity === 'medium' ? 15 : 10,
      temperature: 0.7,
    };

    // Gather inputs from dependencies
    const inputs: string[] = [];
    for (const depId of subtask.inputs) {
      const depSubagent = this.state.subagents.get(depId);
      if (depSubagent?.result) {
        inputs.push(depSubagent.result.output);
      }
    }

    const subagent: Subagent = {
      config,
      status: 'working',
      messages: [],
    };

    this.state.subagents.set(taskId, subagent);

    // Execute the subagent
    try {
      const result = await this.executeSubagent(subagent, inputs);
      subagent.result = result;
      subagent.status = result.success ? 'completed' : 'failed';

      // Broadcast result
      this.broadcast({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        from: config.id,
        to: 'broadcast',
        type: 'result',
        payload: result,
        priority: subtask.priority,
      });
    } catch (error) {
      subagent.status = 'failed';
      subagent.result = {
        success: false,
        output: error instanceof Error ? error.message : 'Execution failed',
        metrics: { iterations: 0, tokensUsed: 0, executionTime: 0 },
      };
    }
  }

  // Execute a single subagent
  private async executeSubagent(
    subagent: Subagent,
    inputs: string[]
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    
    const prompt = `${subagent.config.systemPrompt}\n\n` +
      (inputs.length > 0 ? `Inputs from previous tasks:\n${inputs.join('\n\n')}\n\n` : '') +
      `Execute your task and provide a detailed result.`;

    const response = await this.kimi.complete(
      [{ role: 'user', content: prompt }],
      { temperature: subagent.config.temperature, maxTokens: 4000 }
    );

    const output = response.choices[0]?.message?.content || '';

    return {
      success: true,
      output,
      metrics: {
        iterations: 1,
        tokensUsed: response.usage?.total_tokens || 0,
        executionTime: Date.now() - startTime,
      },
    };
  }

  // Phase 3: Coordinate results and resolve conflicts
  private async coordinateResults(): Promise<void> {
    if (this.strategy.conflictResolution === 'orchestrator_decides') {
      // Check for conflicts in results
      const results = Array.from(this.state.subagents.values())
        .map(s => s.result)
        .filter((r): r is SubagentResult => !!r);

      // Simple conflict detection: very different outputs
      // In production, this would use embeddings or LLM-based comparison
      if (results.length > 1) {
        const outputs = results.map(r => r.output);
        // For now, just store in shared context
        this.state.sharedContext['individualResults'] = outputs;
      }
    }
  }

  // Phase 4: Aggregate results
  private async aggregateResults(): Promise<SwarmResult> {
    const subagentResults = new Map<string, SubagentResult>();
    
    for (const [taskId, subagent] of this.state.subagents) {
      if (subagent.result) {
        subagentResults.set(taskId, subagent.result);
      }
    }

    // Use LLM to synthesize results if auto-merge is enabled
    let aggregatedOutput = '';
    if (this.strategy.autoMergeResults && subagentResults.size > 1) {
      aggregatedOutput = await this.synthesizeResults(subagentResults);
    } else {
      // Just concatenate results
      aggregatedOutput = Array.from(subagentResults.values())
        .map(r => r.output)
        .join('\n\n---\n\n');
    }

    const success = Array.from(subagentResults.values()).every(r => r.success);

    return {
      success,
      objective: this.state.objective,
      subagentResults,
      aggregatedOutput,
      metrics: {
        totalSubagents: this.state.subagents.size,
        totalMessages: this.state.messageBus.length,
        parallelExecutions: this.state.decomposition?.parallelGroups.length || 0,
        totalExecutionTime: 0, // Will be set by caller
      },
    };
  }

  // Synthesize multiple results into coherent output
  private async synthesizeResults(
    results: Map<string, SubagentResult>
  ): Promise<string> {
    const outputs = Array.from(results.entries())
      .map(([id, r]) => `Task ${id}:\n${r.output}`)
      .join('\n\n');

    const prompt = `Synthesize these task outputs into a coherent, unified response:\n\n${outputs}\n\n` +
      `Provide a well-structured synthesis that integrates all the information. ` +
      `Eliminate redundancies and ensure smooth flow.`;

    const response = await this.kimi.complete(
      [{ role: 'user', content: prompt }],
      { temperature: 0.5, maxTokens: 4000 }
    );

    return response.choices[0]?.message?.content || '';
  }

  // Message bus operations
  send(message: SwarmMessage): void {
    this.state.messageBus.push(message);
    
    // Notify handlers
    const handlers = this.messageHandlers.get(message.to) || [];
    for (const handler of handlers) {
      handler(message);
    }
    
    // Notify broadcast handlers
    if (message.to !== 'broadcast') {
      const broadcastHandlers = this.messageHandlers.get('broadcast') || [];
      for (const handler of broadcastHandlers) {
        handler(message);
      }
    }
  }

  broadcast(message: SwarmMessage): void {
    this.send({ ...message, to: 'broadcast' });
  }

  onMessage(recipient: string, handler: (message: SwarmMessage) => void): void {
    if (!this.messageHandlers.has(recipient)) {
      this.messageHandlers.set(recipient, []);
    }
    this.messageHandlers.get(recipient)!.push(handler);
  }

  // Get current state
  getState(): SwarmState {
    return this.state;
  }

  // Checkpoint the entire swarm
  async checkpoint(): Promise<string> {
    // Checkpoint each subagent
    for (const [, subagent] of this.state.subagents) {
      if (subagent.status === 'working') {
        // Would checkpoint via hibernation manager
        // subagent.checkpointId = await this._hibernation.checkpoint(...)
      }
    }
    
    return this.state.id;
  }
}

// Singleton for the swarm
let orchestrator: SwarmOrchestrator | null = null;

export function getSwarmOrchestrator(
  kimi: KimiClient,
  hibernation: HibernationManager
): SwarmOrchestrator {
  if (!orchestrator) {
    orchestrator = new SwarmOrchestrator(kimi, hibernation);
  }
  return orchestrator;
}
