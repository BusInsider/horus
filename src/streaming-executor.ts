// Streaming Tool Executor - Parse and execute tools mid-stream
// Based on Claude Code's streaming implementation
// Hides 2-5 seconds of latency per multi-tool turn

import { Tool, ToolContext, ToolResult } from './tools/types.js';
import { ToolClassification, ToolOrchestrator } from './tools/orchestrator.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  complete: boolean; // Whether we have the full JSON
}

export interface StreamEvent {
  type: 'token' | 'tool_start' | 'tool_complete' | 'error' | 'done';
  content?: string;
  toolCall?: ParsedToolCall;
  result?: ToolResult;
  error?: Error;
}

export interface StreamingExecutorOptions {
  maxParallelReads: number;
  enableMidStreamExecution: boolean;
  idleTimeoutMs: number;
}

// ============================================================================
// INCREMENTAL TOOL PARSER
// ============================================================================

/**
 * Parses tool calls incrementally from a stream.
 * Starts returning tool calls before the full JSON is complete.
 */
export class IncrementalToolParser {
  private buffer = '';
  private pendingCalls = new Map<string, Partial<ParsedToolCall>>();
  private callCounter = 0;
  
  // Process a chunk of streaming text
  *processChunk(chunk: string): Generator<ParsedToolCall> {
    this.buffer += chunk;
    
    // Look for complete tool calls
    const pattern = /<(\w+)>(\{[\s\S]*?\})<\/\1>/g;
    const matches: Array<{ name: string; jsonStr: string; index: number; length: number }> = [];
    let match: RegExpExecArray | null;
    
    // Collect all matches first
    while ((match = pattern.exec(this.buffer)) !== null) {
      matches.push({
        name: match[1],
        jsonStr: match[2],
        index: match.index,
        length: match[0].length,
      });
    }
    
    // Process matches in reverse order (to safely modify buffer)
    for (let i = matches.length - 1; i >= 0; i--) {
      const { name, jsonStr, index, length } = matches[i];
      
      try {
        const args = JSON.parse(jsonStr);
        const id = `call_${++this.callCounter}`;
        
        yield {
          id,
          name,
          arguments: args,
          complete: true,
        };
        
        // Remove from buffer to avoid re-processing
        this.buffer = this.buffer.substring(0, index) + this.buffer.substring(index + length);
      } catch {
        // JSON incomplete, will try again next chunk
      }
    }
    
    // Look for partial/incomplete tool calls
    // Pattern: <toolname>{partial_json
    const partialPattern = /<(\w+)>(\{[^}]*)$/;
    const partialMatch = this.buffer.match(partialPattern);
    
    if (partialMatch && !this.buffer.includes(`</${partialMatch[1]}>`)) {
      const name = partialMatch[1];
      const partialJson = partialMatch[2];
      
      // Try to parse as much as we have
      try {
        // Add closing braces to attempt parse
        const attemptJson = partialJson + '}'.repeat(this.countMissingBraces(partialJson));
        const args = JSON.parse(attemptJson);
        
        // If we got here, we have enough to start
        const id = `call_${++this.callCounter}`;
        yield {
          id,
          name,
          arguments: args,
          complete: false, // Mark as incomplete - may need to update later
        };
      } catch {
        // Not enough to parse yet
      }
    }
  }
  
  private countMissingBraces(json: string): number {
    let open = 0;
    let close = 0;
    let inString = false;
    let escapeNext = false;
    
    for (const char of json) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      
      if (char === '{') open++;
      if (char === '}') close++;
    }
    
    return Math.max(0, open - close);
  }
  
  reset(): void {
    this.buffer = '';
    this.pendingCalls.clear();
    this.callCounter = 0;
  }
}

// ============================================================================
// STREAMING TOOL EXECUTOR
// ============================================================================

export class StreamingToolExecutor {
  private orchestrator: ToolOrchestrator;
  private parser: IncrementalToolParser;
  private queuedTools: Map<string, {
    tool: Tool;
    args: Record<string, unknown>;
    classification: ToolClassification;
    resolve: (result: ToolResult) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private executing = new Set<string>();
  private completed = new Map<string, ToolResult>();
  private siblingAbort = new AbortController();
  private options: StreamingExecutorOptions;
  
  constructor(options?: Partial<StreamingExecutorOptions>) {
    this.orchestrator = new ToolOrchestrator();
    this.parser = new IncrementalToolParser();
    this.options = {
      maxParallelReads: 10,
      enableMidStreamExecution: true,
      idleTimeoutMs: 90000, // 90 seconds
      ...options,
    };
  }
  
  /**
   * Process a stream chunk and execute tools as soon as they're parseable.
   * Yields events for UI updates.
   */
  async *processStream(
    stream: AsyncIterable<string>,
    tools: Map<string, Tool>,
    context: ToolContext
  ): AsyncGenerator<StreamEvent> {
    this.reset();
    
    // Start idle timeout watchdog
    const watchdog = this.startWatchdog();
    
    try {
      for await (const chunk of stream) {
        watchdog.reset();
        
        // Yield token for display
        yield { type: 'token', content: chunk };
        
        // Parse for tool calls
        for (const parsed of this.parser.processChunk(chunk)) {
          const tool = tools.get(parsed.name);
          if (!tool) continue;
          
          // Queue for execution
          this.queueTool(parsed, tool);
          
          // Start execution immediately if enabled
          if (this.options.enableMidStreamExecution) {
            this.executeQueued(context).catch(() => {});
          }
          
          yield { type: 'tool_start', toolCall: parsed };
        }
      }
      
      // Stream complete - execute any remaining queued tools
      const results = await this.executeAll(context);
      
      for (const [, result] of results) {
        yield { type: 'tool_complete', result };
      }
      
      yield { type: 'done' };
      
    } catch (error) {
      yield { 
        type: 'error', 
        error: error instanceof Error ? error : new Error(String(error)) 
      };
    } finally {
      watchdog.stop();
    }
  }
  
  private queueTool(parsed: ParsedToolCall, tool: Tool): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      this.queuedTools.set(parsed.id, {
        tool,
        args: parsed.arguments,
        classification: this.orchestrator.getClassification(tool.name),
        resolve,
        reject,
      });
    });
  }
  
  private async executeQueued(context: ToolContext): Promise<void> {
    // Get ready tools (those with complete arguments)
    const ready = Array.from(this.queuedTools.entries())
      .filter(([id]) => !this.executing.has(id) && !this.completed.has(id));
    
    if (ready.length === 0) return;
    
    // Group by classification for parallel/serial execution
    const readOnly = ready.filter(([_, t]) => t.classification.concurrency === 'read-only');
    const write = ready.filter(([_, t]) => t.classification.concurrency === 'write');
    const blocking = ready.filter(([_, t]) => t.classification.concurrency === 'blocking');
    
    // Execute read-only in parallel (up to max)
    const toExecute = readOnly.slice(0, this.options.maxParallelReads);
    
    for (const [id, toolInfo] of toExecute) {
      this.executeTool(id, toolInfo, context);
    }
    
    // Execute one write tool if no reads running
    if (toExecute.length === 0 && write.length > 0) {
      const [id, toolInfo] = write[0];
      await this.executeTool(id, toolInfo, context);
    }
    
    // Execute one blocking tool if nothing else running
    if (toExecute.length === 0 && write.length === 0 && blocking.length > 0) {
      const [id, toolInfo] = blocking[0];
      await this.executeTool(id, toolInfo, context);
    }
  }
  
  private async executeTool(
    id: string,
    toolInfo: {
      tool: Tool;
      args: Record<string, unknown>;
      classification: ToolClassification;
      resolve: (result: ToolResult) => void;
      reject: (error: Error) => void;
    },
    context: ToolContext
  ): Promise<void> {
    if (this.siblingAbort.signal.aborted) {
      toolInfo.reject(new Error('Aborted due to sibling failure'));
      return;
    }
    
    this.executing.add(id);
    
    try {
      const result = await toolInfo.tool.execute(toolInfo.args, context);
      this.completed.set(id, result);
      toolInfo.resolve(result);
    } catch (error) {
      // Abort siblings on failure
      this.siblingAbort.abort();
      toolInfo.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.executing.delete(id);
      this.queuedTools.delete(id);
    }
  }
  
  private async executeAll(context: ToolContext): Promise<Map<string, ToolResult>> {
    while (this.queuedTools.size > 0) {
      await this.executeQueued(context);
      
      // Wait a bit for async executions to complete
      if (this.executing.size > 0) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    
    return this.completed;
  }
  
  private startWatchdog(): { reset: () => void; stop: () => void } {
    let lastActivity = Date.now();
    let timeoutId: NodeJS.Timeout | null = null;
    
    const check = () => {
      const idle = Date.now() - lastActivity;
      if (idle > this.options.idleTimeoutMs) {
        this.siblingAbort.abort();
        return;
      }
      timeoutId = setTimeout(check, 1000);
    };
    
    timeoutId = setTimeout(check, 1000);
    
    return {
      reset: () => { lastActivity = Date.now(); },
      stop: () => { if (timeoutId) clearTimeout(timeoutId); },
    };
  }
  
  private reset(): void {
    this.parser.reset();
    this.queuedTools.clear();
    this.executing.clear();
    this.completed.clear();
    this.siblingAbort = new AbortController();
  }
}

// ============================================================================
// FALLBACK HANDLER
// ============================================================================

/**
 * Handles fallback to non-streaming execution if streaming fails.
 * Preserves error counts so fallback logic doesn't double-count.
 */
export async function executeWithFallback(
  streamingFn: () => AsyncIterable<StreamEvent>,
  fallbackFn: () => Promise<ToolResult[]>,
  errorTracker: { consecutive529s: number }
): Promise<ToolResult[]> {
  try {
    const results: ToolResult[] = [];
    
    for await (const event of streamingFn()) {
      if (event.type === 'tool_complete' && event.result) {
        results.push(event.result);
      }
      if (event.type === 'error') {
        throw event.error;
      }
    }
    
    return results;
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    // Track 529 errors
    if (message.includes('529') || message.includes('overloaded')) {
      errorTracker.consecutive529s++;
    }
    
    // Fallback to non-streaming
    console.warn('Streaming failed, falling back to non-streaming:', message);
    return fallbackFn();
  }
}
