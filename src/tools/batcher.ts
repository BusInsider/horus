// Tool Call Batcher - MoE Optimization for Kimi
// Groups parallel tool calls by semantic similarity for efficient execution

import { Tool, ToolContext, ToolResult } from './types.js';

export interface BatchedCall {
  id: string;
  toolName: string;
  tool: Tool;
  args: Record<string, unknown>;
  priority: number;
  dependencies?: string[]; // IDs of calls that must complete first
}

export interface Batch {
  id: string;
  calls: BatchedCall[];
  strategy: 'parallel' | 'sequential' | 'semantic';
  semanticCluster?: string; // For semantic grouping
}

export interface BatchResult {
  batchId: string;
  results: Map<string, ToolResult>;
  executionTime: number;
  parallelCount: number;
}

// Semantic categories for clustering similar operations
const SEMANTIC_CLUSTERS = {
  filesystem: ['view', 'edit', 'cat', 'ls', 'mkdir', 'rm', 'glob', 'grep'],
  network: ['fetch'],
  git: ['git_status', 'git_diff', 'git_log'],
  data: ['json_parse', 'json_format', 'math'],
  memory: ['recall', 'remember', 'index'],
  skills: ['skill_list', 'skill_create', 'skill_view', 'skill_delete', 'skill_evolve', 'skill_stats'],
};

export class ToolBatcher {
  private callCounter = 0;

  // Group tool calls into optimized batches
  batchCalls(calls: BatchedCall[]): Batch[] {
    // Separate calls by dependencies
    const { independent, dependent } = this.separateByDependencies(calls);

    // Group independent calls by semantic cluster
    const semanticBatches = this.groupBySemanticCluster(independent);

    // Group dependent calls by dependency chains
    const dependencyBatches = this.groupByDependencies(dependent);

    return [...semanticBatches, ...dependencyBatches];
  }

  // Separate calls into independent and dependent
  private separateByDependencies(calls: BatchedCall[]): {
    independent: BatchedCall[];
    dependent: BatchedCall[];
  } {
    const independent: BatchedCall[] = [];
    const dependent: BatchedCall[] = [];

    for (const call of calls) {
      if (call.dependencies && call.dependencies.length > 0) {
        dependent.push(call);
      } else {
        independent.push(call);
      }
    }

    return { independent, dependent };
  }

  // Group calls by semantic similarity (MoE optimization)
  private groupBySemanticCluster(calls: BatchedCall[]): Batch[] {
    const batches = new Map<string, BatchedCall[]>();

    for (const call of calls) {
      const cluster = this.getSemanticCluster(call.toolName);
      if (!batches.has(cluster)) {
        batches.set(cluster, []);
      }
      batches.get(cluster)!.push(call);
    }

    return Array.from(batches.entries()).map(([cluster, calls]) => ({
      id: `batch-${this.callCounter++}`,
      calls,
      strategy: 'parallel' as const,
      semanticCluster: cluster,
    }));
  }

  // Determine semantic cluster for a tool
  private getSemanticCluster(toolName: string): string {
    for (const [cluster, tools] of Object.entries(SEMANTIC_CLUSTERS)) {
      if (tools.includes(toolName) || tools.some(t => toolName.startsWith(t))) {
        return cluster;
      }
    }
    // Check if it's a skill
    if (toolName.includes('_') && !toolName.startsWith('git_')) {
      return 'skills';
    }
    return 'other';
  }

  // Group dependent calls into sequential batches respecting dependencies
  private groupByDependencies(calls: BatchedCall[]): Batch[] {
    if (calls.length === 0) return [];

    // Topological sort for dependency resolution
    const sorted = this.topologicalSort(calls);

    // Group into levels where each level can execute in parallel
    const levels: BatchedCall[][] = [];
    const completed = new Set<string>();

    while (sorted.length > 0) {
      const level: BatchedCall[] = [];
      const remaining: BatchedCall[] = [];

      for (const call of sorted) {
        const depsSatisfied = !call.dependencies || 
          call.dependencies.every(dep => completed.has(dep));

        if (depsSatisfied) {
          level.push(call);
          completed.add(call.id);
        } else {
          remaining.push(call);
        }
      }

      if (level.length > 0) {
        levels.push(level);
      }

      if (remaining.length === sorted.length) {
        // Circular dependency detected, break to avoid infinite loop
        console.warn('Circular dependency detected in tool calls');
        levels.push(remaining);
        break;
      }

      sorted.length = 0;
      sorted.push(...remaining);
    }

    return levels.map((calls) => ({
      id: `dep-batch-${this.callCounter++}`,
      calls,
      strategy: 'parallel' as const,
    }));
  }

  // Simple topological sort
  private topologicalSort(calls: BatchedCall[]): BatchedCall[] {
    const result: BatchedCall[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();
    const callMap = new Map(calls.map(c => [c.id, c]));

    const visit = (call: BatchedCall) => {
      if (temp.has(call.id)) {
        throw new Error(`Circular dependency detected: ${call.id}`);
      }
      if (visited.has(call.id)) return;

      temp.add(call.id);

      if (call.dependencies) {
        for (const depId of call.dependencies) {
          const dep = callMap.get(depId);
          if (dep) visit(dep);
        }
      }

      temp.delete(call.id);
      visited.add(call.id);
      result.push(call);
    };

    for (const call of calls) {
      if (!visited.has(call.id)) {
        visit(call);
      }
    }

    return result;
  }

  // Execute a batch
  async executeBatch(batch: Batch, context: ToolContext): Promise<BatchResult> {
    const startTime = Date.now();
    const results = new Map<string, ToolResult>();

    if (batch.strategy === 'sequential') {
      // Execute sequentially
      for (const call of batch.calls) {
        const result = await this.executeCall(call, context);
        results.set(call.id, result);
      }
    } else {
      // Execute in parallel
      const promises = batch.calls.map(async (call) => {
        const result = await this.executeCall(call, context);
        return { id: call.id, result };
      });

      const settled = await Promise.allSettled(promises);

      for (const item of settled) {
        if (item.status === 'fulfilled') {
          results.set(item.value.id, item.value.result);
        } else {
          // Handle rejection
          results.set(batch.calls[0]?.id || 'unknown', {
            ok: false,
            error: 'Batch execution failed',
          });
        }
      }
    }

    return {
      batchId: batch.id,
      results,
      executionTime: Date.now() - startTime,
      parallelCount: batch.calls.length,
    };
  }

  // Execute a single call
  private async executeCall(call: BatchedCall, context: ToolContext): Promise<ToolResult> {
    try {
      return await call.tool.execute(call.args, context);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      };
    }
  }

  // Execute multiple batches (respecting batch order)
  async executeBatches(batches: Batch[], context: ToolContext): Promise<BatchResult[]> {
    const results: BatchResult[] = [];

    for (const batch of batches) {
      const result = await this.executeBatch(batch, context);
      results.push(result);

      // Make results available for subsequent batches
      if (context.env) {
        for (const [id, toolResult] of result.results) {
          context.env[`RESULT_${id}`] = JSON.stringify(toolResult);
        }
      }
    }

    return results;
  }

  // Optimize batch sizes for MoE (Mixture of Experts)
  // Kimi's MoE architecture works well with grouped similar operations
  optimizeForMoE(batches: Batch[]): Batch[] {
    const MAX_BATCH_SIZE = 8; // Kimi can handle up to 128 tools, but we limit batch size

    const optimized: Batch[] = [];

    for (const batch of batches) {
      if (batch.calls.length <= MAX_BATCH_SIZE) {
        optimized.push(batch);
      } else {
        // Split large batches
        for (let i = 0; i < batch.calls.length; i += MAX_BATCH_SIZE) {
          const chunk = batch.calls.slice(i, i + MAX_BATCH_SIZE);
          optimized.push({
            id: `${batch.id}-${i / MAX_BATCH_SIZE}`,
            calls: chunk,
            strategy: batch.strategy,
            semanticCluster: batch.semanticCluster,
          });
        }
      }
    }

    return optimized;
  }

  // Calculate batch statistics
  getStats(batches: Batch[]): {
    totalCalls: number;
    batchCount: number;
    avgBatchSize: number;
    byCluster: Record<string, number>;
  } {
    const totalCalls = batches.reduce((sum, b) => sum + b.calls.length, 0);
    const byCluster: Record<string, number> = {};

    for (const batch of batches) {
      const cluster = batch.semanticCluster || 'unknown';
      byCluster[cluster] = (byCluster[cluster] || 0) + batch.calls.length;
    }

    return {
      totalCalls,
      batchCount: batches.length,
      avgBatchSize: totalCalls / batches.length,
      byCluster,
    };
  }
}

// Singleton instance
let batcher: ToolBatcher | null = null;

export function getToolBatcher(): ToolBatcher {
  if (!batcher) {
    batcher = new ToolBatcher();
  }
  return batcher;
}
