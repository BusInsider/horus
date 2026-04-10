// Subagent - Individual agent in the swarm
// Can operate independently or as part of hierarchical structure

import { randomUUID } from 'crypto';
import { KimiClient, Message } from '../kimi.js';
import { Tool } from '../tools/types.js';
import { SubagentConfig, SubagentResult, SwarmMessage } from './types.js';
import { SwarmOrchestrator } from './orchestrator.js';

export interface SubagentOptions {
  config: SubagentConfig;
  kimi: KimiClient;
  orchestrator?: SwarmOrchestrator;
  tools?: Map<string, Tool>;
}

export class Subagent {
  config: SubagentConfig;
  private kimi: KimiClient;
  private orchestrator?: SwarmOrchestrator;
  private tools: Map<string, Tool>;
  private messages: Message[] = [];
  private iteration = 0;
  private startTime = 0;

  constructor(options: SubagentOptions) {
    this.config = options.config;
    this.kimi = options.kimi;
    this.orchestrator = options.orchestrator;
    this.tools = options.tools || new Map();
  }

  // Execute the subagent's task
  async execute(taskDescription: string, context?: string[]): Promise<SubagentResult> {
    this.startTime = Date.now();
    this.iteration = 0;

    // Initialize with system prompt
    this.messages = [
      { role: 'system', content: this.config.systemPrompt },
    ];

    // Add context from parent tasks
    if (context && context.length > 0) {
      this.messages.push({
        role: 'user',
        content: `Context from previous tasks:\n${context.join('\n\n')}`,
      });
    }

    // Add the task
    this.messages.push({
      role: 'user',
      content: taskDescription,
    });

    // ReAct loop
    while (this.iteration < this.config.maxIterations) {
      this.iteration++;

      try {
        // Get AI response
        const response = await this.kimi.complete(
          this.messages,
          { temperature: this.config.temperature, maxTokens: 4000 }
        );

        const assistantMessage = response.choices[0]?.message;
        if (!assistantMessage) {
          break;
        }

        this.messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
        });

        // Check for tool calls
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          // Execute tool calls
          const toolResults = await this.executeToolCalls(assistantMessage.tool_calls);
          
          // Add results to conversation
          for (const result of toolResults) {
            this.messages.push({
              role: 'tool',
              content: result.ok 
                ? (result.content || 'Done')
                : `Error: ${result.error}`,
              tool_call_id: result.toolCallId,
            });
          }
        } else {
          // No tool calls, task is complete
          return this.createResult(true, assistantMessage.content || '');
        }
      } catch (error) {
        return this.createResult(
          false,
          '',
          error instanceof Error ? error.message : 'Execution failed'
        );
      }
    }

    // Max iterations reached
    return this.createResult(
      false,
      '',
      `Max iterations (${this.config.maxIterations}) reached`
    );
  }

  // Execute tool calls
  private async executeToolCalls(
    toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>
  ): Promise<Array<{ ok: boolean; content?: string; error?: string; toolCallId: string }>> {
    const results = [];

    for (const call of toolCalls) {
      const toolName = call.function.name;
      const tool = this.tools.get(toolName);

      if (!tool) {
        results.push({
          ok: false,
          error: `Tool "${toolName}" not available to this subagent`,
          toolCallId: call.id,
        });
        continue;
      }

      try {
        const args = JSON.parse(call.function.arguments);
        const result = await tool.execute(args, {
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        });

        results.push({
          ok: result.ok,
          content: result.ok ? result.content : undefined,
          error: result.ok ? undefined : result.error,
          toolCallId: call.id,
        });

        // Notify orchestrator if present
        if (this.orchestrator) {
          this.orchestrator.send({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            from: this.config.id,
            to: 'orchestrator',
            type: 'result',
            payload: { tool: toolName, result },
            priority: 1,
          });
        }
      } catch (error) {
        results.push({
          ok: false,
          error: error instanceof Error ? error.message : 'Tool execution failed',
          toolCallId: call.id,
        });
      }
    }

    return results;
  }

  // Query another subagent or the orchestrator
  async query(targetId: string, question: string): Promise<string> {
    if (!this.orchestrator) {
      return 'No orchestrator available';
    }

    const message: SwarmMessage = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      from: this.config.id,
      to: targetId,
      type: 'query',
      payload: question,
      priority: 1,
    };

    this.orchestrator.send(message);

    // Wait for response (simplified - in production would use async/await with timeout)
    return 'Query sent';
  }

  // Report result to orchestrator
  report(result: unknown): void {
    if (this.orchestrator) {
      this.orchestrator.send({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        from: this.config.id,
        to: 'orchestrator',
        type: 'result',
        payload: result,
        priority: 1,
      });
    }
  }

  // Create result object
  private createResult(
    success: boolean,
    output: string,
    error?: string
  ): SubagentResult {
    return {
      success,
      output: error ? `${output}\n\nError: ${error}` : output,
      metrics: {
        iterations: this.iteration,
        tokensUsed: 0, // Would track from API responses
        executionTime: Date.now() - this.startTime,
      },
    };
  }

  // Get conversation history
  getMessages(): Message[] {
    return [...this.messages];
  }

  // Get current iteration
  getIteration(): number {
    return this.iteration;
  }
}

// Factory function
export function createSubagent(options: SubagentOptions): Subagent {
  return new Subagent(options);
}
