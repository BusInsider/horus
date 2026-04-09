/**
 * Integration layer for Prompt Cacher and Streaming Executor
 * 
 * This module provides a bridge between the EnhancedAgent and the new
 * streaming/concurrency infrastructure.
 */

import { Message, ToolDefinition, ToolCall } from './kimi.js';
import { Tool, ToolContext, ToolResult } from './tools/types.js';
import { StreamingToolExecutor } from './streaming-executor.js';
import { PromptCacheManager, buildContextReminder } from './prompt-cacher.js';
import { TerminalUI } from './ui/terminal.js';
import { ErrorHandler } from './error-handler.js';

export interface AgentIntegrationConfig {
  kimi: { stream: (messages: Message[], tools: ToolDefinition[]) => AsyncIterable<any> };
  tools: Map<string, Tool>;
  ui: TerminalUI;
  errorHandler: ErrorHandler;
  cwd: string;
  getSessionId: () => string | undefined;
  onToolStart?: (toolName: string, toolCallId: string) => void;
  onToolComplete?: (toolName: string, result: ToolResult, toolCallId: string) => void;
  onToolError?: (toolName: string, error: string, toolCallId: string) => void;
  onCheckpointNeeded?: (toolName: string) => boolean;
}

/**
 * Builds optimized context messages with static/dynamic separation for caching
 */
export function buildOptimizedContext(
  cacher: PromptCacheManager,
  memories: Array<{ type: string; content?: string; action?: string; outcome?: string }>,
  includeContextInjection: boolean = true,
  contextData?: {
    cwd: string;
    date: string;
    gitBranch?: string;
    recentFiles?: string[];
  }
): { cachedPrompt: { static: string; dynamic: string; full: string; cacheHitRate: number }; contextInjection?: string } {
  // Static sections (cached by API)
  cacher.addStaticSection(`You are Horus, an intelligent coding assistant with memory and planning capabilities.

CAPABILITIES:
- View and edit files
- Execute bash commands  
- Search code with ripgrep
- Access memory of past actions
- Create checkpoints for rollback
- Spawn subagents for parallel tasks

TOOLS:
- view: View files/directories
- edit: Edit files with diff matching
- bash: Execute commands
- search: Search code
- recall: Query memory
- remember: Store facts
- checkpoint: Create rollback point
- rollback: Rollback to checkpoint
- spawn: Spawn subagent (if available)

Be concise but thorough. Use tools proactively. Check state before changes.`, 100);

  // Add memories as volatile (changes every turn)
  if (memories.length > 0) {
    const memoryContext = formatMemoriesForContext(memories);
    cacher.setVolatileComputer(() => memoryContext);
  }

  const cachedPrompt = cacher.buildPrompt();
  
  let contextInjection: string | undefined;
  if (includeContextInjection && contextData) {
    contextInjection = buildContextReminder(contextData);
  }

  return {
    cachedPrompt,
    contextInjection,
  };
}

function formatMemoriesForContext(
  memories: Array<{ type: string; content?: string; action?: string; outcome?: string }>
): string {
  const facts = memories
    .filter(m => m.type === 'fact' && m.content)
    .map(m => `- ${m.content}`)
    .join('\n');
  
  const episodes = memories
    .filter(m => m.type === 'episode' && m.action)
    .map(m => `- ${m.action}: ${m.outcome || 'completed'}`)
    .join('\n');
  
  let context = '';
  if (facts) {
    context += `RELEVANT FACTS:\n${facts}\n\n`;
  }
  if (episodes) {
    context += `RELEVANT PAST ACTIONS:\n${episodes}\n`;
  }
  
  return context.trim();
}

/**
 * Adapter to convert StreamEvent to the format expected by existing UI
 */
export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  duration: number;
  checkpointCreated?: boolean;
}

/**
 * Process a complete step with streaming and tool execution
 * This replaces the sequential executeToolCallWithRecovery pattern
 */
export async function runStreamingStep(
  config: AgentIntegrationConfig,
  messages: Message[],
  toolDefinitions: ToolDefinition[]
): Promise<{
  assistantContent: string;
  toolResults: ToolExecutionResult[];
  shouldContinue: boolean;
}> {
  const toolResults: ToolExecutionResult[] = [];
  let assistantContent = '';
  const processedToolCalls = new Set<string>();

  const executor = new StreamingToolExecutor();
  const context: ToolContext = {
    cwd: config.cwd,
    sessionId: config.getSessionId(),
  };

  try {
    for await (const event of executor.processStream(
      config.kimi.stream(messages, toolDefinitions),
      config.tools,
      context
    )) {
      switch (event.type) {
        case 'token':
          if (event.content) {
            assistantContent += event.content;
            config.ui.write(event.content);
          }
          break;

        case 'tool_start':
          if (event.toolCall) {
            config.onToolStart?.(event.toolCall.name, event.toolCall.id);
            config.ui.showToolExecuting(event.toolCall.name);
          }
          break;

        case 'tool_complete':
          if (event.toolCall && event.result && !processedToolCalls.has(event.toolCall.id)) {
            processedToolCalls.add(event.toolCall.id);
            
            const duration = 0; // TODO: Track actual duration
            
            toolResults.push({
              toolCallId: event.toolCall.id,
              toolName: event.toolCall.name,
              result: event.result,
              duration,
            });

            if (event.result.ok) {
              config.ui.showToolResult(event.toolCall.name, event.result.content);
              config.onToolComplete?.(event.toolCall.name, event.result, event.toolCall.id);
            } else {
              config.ui.showToolError(event.toolCall.name, event.result.error);
              config.onToolError?.(event.toolCall.name, event.result.error, event.toolCall.id);
            }

            // Check if checkpoint needed
            if (config.onCheckpointNeeded?.(event.toolCall.name)) {
              // Checkpoint creation is handled by caller
            }
          }
          break;

        case 'error':
          if (event.error) {
            throw event.error;
          }
          throw new Error('Unknown streaming error');

        case 'done':
          // Stream complete
          break;
      }
    }

    return {
      assistantContent,
      toolResults,
      shouldContinue: toolResults.length > 0,
    };

  } catch (error) {
    // Let error handler deal with it
    throw error;
  }
}

/**
 * Simple wrapper for backward compatibility
 * Executes tools sequentially with recovery (legacy mode)
 */
export async function executeToolWithRecovery(
  tool: Tool,
  toolCall: ToolCall,
  context: ToolContext,
  ui: TerminalUI,
  errorHandler: ErrorHandler
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    args = {};
  }

  ui.showToolExecuting(tool.name);

  try {
    const result = await tool.execute(args, context);
    return result;
  } catch (error) {
    const recovery = await errorHandler.handle(error as Error, {
      operation: 'executeToolCall',
      tool: tool.name,
      sessionId: context.sessionId,
      recoverable: true,
    });

    if (recovery.recovered) {
      // Retry
      return executeToolWithRecovery(tool, toolCall, context, ui, errorHandler);
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
