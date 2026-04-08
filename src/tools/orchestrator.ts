// Tool Orchestrator - Concurrency classification and execution
// Based on Claude Code's toolOrchestration.ts

import { Tool, ToolContext, ToolResult } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

export type ToolConcurrency = 'read-only' | 'write' | 'blocking';

export interface ToolClassification {
  name: string;
  concurrency: ToolConcurrency;
  maxResultSizeChars?: number;
}

export interface ToolCall {
  id: string;
  tool: Tool;
  args: Record<string, unknown>;
  classification: ToolClassification;
}

export interface ToolExecutionResult {
  id: string;
  result: ToolResult;
  duration: number;
  error?: Error;
}

// ============================================================================
// TOOL CLASSIFICATION REGISTRY
// ============================================================================

const DEFAULT_CLASSIFICATIONS: Record<string, ToolClassification> = {
  // Read-only tools (can run in parallel)
  view: { name: 'view', concurrency: 'read-only', maxResultSizeChars: 50000 },
  search: { name: 'search', concurrency: 'read-only', maxResultSizeChars: 10000 },
  glob: { name: 'glob', concurrency: 'read-only', maxResultSizeChars: 10000 },
  recall: { name: 'recall', concurrency: 'read-only', maxResultSizeChars: 10000 },
  
  // Write tools (must run serially)
  edit: { name: 'edit', concurrency: 'write' },
  create: { name: 'create', concurrency: 'write' },
  delete: { name: 'delete', concurrency: 'write' },
  
  // Blocking tools (exclusive access)
  bash: { name: 'bash', concurrency: 'blocking' },
  remember: { name: 'remember', concurrency: 'write' },
  index: { name: 'index', concurrency: 'write' },
};

// ============================================================================
// TOOL ORCHESTRATOR
// ============================================================================

export class ToolOrchestrator {
  private classifications: Map<string, ToolClassification>;
  private maxParallelReads: number;
  
  constructor(maxParallelReads: number = 10) {
    this.classifications = new Map(Object.entries(DEFAULT_CLASSIFICATIONS));
    this.maxParallelReads = maxParallelReads;
  }
  
  // Register custom tool classification
  registerClassification(name: string, classification: ToolClassification): void {
    this.classifications.set(name, classification);
  }
  
  // Get classification for a tool
  getClassification(toolName: string): ToolClassification {
    return this.classifications.get(toolName) || {
      name: toolName,
      concurrency: 'blocking', // Safe default
      maxResultSizeChars: 10000,
    };
  }
  
  // ==========================================================================
  // BATCH PARTITIONING
  // ==========================================================================
  
  // Partition tool calls into execution batches based on concurrency
  partitionBatches(calls: ToolCall[]): ToolCall[][] {
    const batches: ToolCall[][] = [];
    let currentBatch: ToolCall[] = [];
    let currentBatchType: ToolConcurrency | null = null;
    
    for (const call of calls) {
      const concurrency = call.classification.concurrency;
      
      // Start new batch if:
      // 1. Different concurrency type
      // 2. Current batch is read-only and at max size
      if (
        currentBatchType !== null &&
        (currentBatchType !== concurrency ||
          (concurrency === 'read-only' && currentBatch.length >= this.maxParallelReads))
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchType = null;
      }
      
      currentBatch.push(call);
      currentBatchType = concurrency;
    }
    
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }
    
    return batches;
  }
  
  // ==========================================================================
  // EXECUTION
  // ==========================================================================
  
  async executeBatches(
    batches: ToolCall[][],
    context: ToolContext,
    onProgress?: (completed: number, total: number) => void
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    let completed = 0;
    const total = batches.reduce((sum, batch) => sum + batch.length, 0);
    
    for (const batch of batches) {
      const batchResults = await this.executeBatch(batch, context);
      results.push(...batchResults);
      completed += batch.length;
      onProgress?.(completed, total);
    }
    
    return results;
  }
  
  private async executeBatch(
    batch: ToolCall[],
    context: ToolContext
  ): Promise<ToolExecutionResult[]> {
    const concurrency = batch[0]?.classification.concurrency;
    
    if (concurrency === 'read-only') {
      // Execute read-only tools in parallel
      return Promise.all(
        batch.map(call => this.executeTool(call, context))
      );
    } else {
      // Execute write/blocking tools serially
      const results: ToolExecutionResult[] = [];
      for (const call of batch) {
        const result = await this.executeTool(call, context);
        results.push(result);
      }
      return results;
    }
  }
  
  private async executeTool(
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const start = performance.now();
    
    try {
      // Apply result budget
      const maxSize = call.classification.maxResultSizeChars || 10000;
      
      const result = await call.tool.execute(call.args, context);
      
      // Truncate if exceeds budget (only for successful string results)
      if (result.ok && result.content.length > maxSize) {
        const truncated = result.content.substring(0, maxSize);
        const budgetResult: ToolResult = {
          ok: true,
          content: `${truncated}\n\n[Result truncated: ${result.content.length - maxSize} chars omitted. Use view to read full content.]`,
          annotations: result.annotations,
        };
        return {
          id: call.id,
          result: budgetResult,
          duration: performance.now() - start,
        };
      }
      
      return {
        id: call.id,
        result,
        duration: performance.now() - start,
      };
    } catch (error) {
      const errorResult: ToolResult = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      return {
        id: call.id,
        result: errorResult,
        duration: performance.now() - start,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

// ============================================================================
// STREAMING TOOL EXECUTOR
// ============================================================================

interface QueuedToolCall {
  id: string;
  tool: Tool;
  args: Record<string, unknown>;
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
}

export class StreamingToolExecutor {
  private orchestrator: ToolOrchestrator;
  private queuedTools: QueuedToolCall[] = [];
  private inProgress = new Set<string>();
  private siblingAbortController = new AbortController();
  
  constructor(orchestrator?: ToolOrchestrator) {
    this.orchestrator = orchestrator || new ToolOrchestrator();
  }
  
  // Queue a tool call for execution
  queue(tool: Tool, args: Record<string, unknown>): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      this.queuedTools.push({
        id: this.generateId(),
        tool,
        args,
        resolve,
        reject,
      });
    });
  }
  
  // Execute all queued tools
  async executeAll(context: ToolContext): Promise<void> {
    // Group queued calls by classification
    const calls: ToolCall[] = this.queuedTools.map(q => ({
      id: q.id,
      tool: q.tool,
      args: q.args,
      classification: this.orchestrator.getClassification(q.tool.name),
    }));
    
    // Clear queue
    this.queuedTools = [];
    
    // Partition and execute
    const batches = this.orchestrator.partitionBatches(calls);
    
    for (const batch of batches) {
      // Check for abort
      if (this.siblingAbortController.signal.aborted) {
        // Generate synthetic errors for remaining
        for (const call of batch) {
          const queued = this.findQueuedCall(call.id);
          if (queued) {
            queued.reject(new Error('Execution aborted due to sibling failure'));
          }
        }
        continue;
      }
      
      const results = await this.executeBatchWithAbort(batch, context);
      
      // Resolve promises
      for (const result of results) {
        const queued = this.findQueuedCall(result.id);
        if (queued) {
          if (result.error) {
            queued.reject(result.error);
            // Abort siblings if one fails
            this.siblingAbortController.abort();
          } else {
            queued.resolve(result.result);
          }
        }
      }
    }
  }
  
  private async executeBatchWithAbort(
    batch: ToolCall[],
    context: ToolContext
  ): Promise<ToolExecutionResult[]> {
    const concurrency = batch[0]?.classification.concurrency;
    
    if (concurrency === 'read-only') {
      // Parallel execution with abort support
      return Promise.all(
        batch.map(async call => {
          // Check abort before starting
          if (this.siblingAbortController.signal.aborted) {
            const abortedResult: ToolResult = { ok: false, error: 'Aborted due to sibling failure' };
            return {
              id: call.id,
              result: abortedResult,
              duration: 0,
              error: new Error('Aborted due to sibling failure'),
            };
          }
          
          this.inProgress.add(call.id);
          const result = await this.executeSingle(call, context);
          this.inProgress.delete(call.id);
          return result;
        })
      );
    } else {
      // Serial execution
      const results: ToolExecutionResult[] = [];
      for (const call of batch) {
        if (this.siblingAbortController.signal.aborted) {
          const abortedResult: ToolResult = { ok: false, error: 'Aborted due to sibling failure' };
          results.push({
            id: call.id,
            result: abortedResult,
            duration: 0,
            error: new Error('Aborted due to sibling failure'),
          });
          continue;
        }
        
        this.inProgress.add(call.id);
        const result = await this.executeSingle(call, context);
        this.inProgress.delete(call.id);
        results.push(result);
      }
      return results;
    }
  }
  
  private async executeSingle(
    call: ToolCall,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const start = performance.now();
    
    try {
      const result = await call.tool.execute(call.args, context);
      return {
        id: call.id,
        result,
        duration: performance.now() - start,
      };
    } catch (error) {
      const errorResult: ToolResult = { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
      return {
        id: call.id,
        result: errorResult,
        duration: performance.now() - start,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
  
  private findQueuedCall(_id: string): QueuedToolCall | undefined {
    // This is a bit hacky - we already removed from queue
    // In real implementation, we'd keep a map
    return undefined;
  }
  
  private generateId(): string {
    return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
  
  reset(): void {
    this.queuedTools = [];
    this.inProgress.clear();
    this.siblingAbortController = new AbortController();
  }
}
