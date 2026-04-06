import { KimiClient, Message, ToolDefinition, ToolCall } from './kimi.js';
import { MemoryManager, RecalledMemory } from './memory/manager.js';
import { Tool, ToolContext } from './tools/types.js';
import { TerminalUI } from './ui/terminal.js';

export interface AgentConfig {
  kimi: KimiClient;
  memory: MemoryManager;
  tools: Map<string, Tool>;
  ui: TerminalUI;
  maxIterations?: number;
}

export class Agent {
  private kimi: KimiClient;
  private memory: MemoryManager;
  private tools: Map<string, Tool>;
  private ui: TerminalUI;
  private maxIterations: number;
  private iterationCount: number = 0;
  private cwd: string = '';

  constructor(config: AgentConfig) {
    this.kimi = config.kimi;
    this.memory = config.memory;
    this.tools = config.tools;
    this.ui = config.ui;
    this.maxIterations = config.maxIterations || 50;
  }

  async run(task: string, cwd: string): Promise<void> {
    this.cwd = cwd;
    this.iterationCount = 0;

    // Start or resume session
    await this.memory.startSession(cwd);
    const session = this.memory.getCurrentSession();
    this.ui.showSessionStart(session!.id, cwd);

    // Index workspace
    this.ui.showIndexingStart();
    const indexResult = await this.memory.indexWorkspace(cwd);
    this.ui.showIndexingComplete(indexResult.files, indexResult.chunks);

    // Add initial system prompt
    await this.memory.addMessage({
      role: 'system',
      content: this.getSystemPrompt(),
    });

    // Add user task
    await this.memory.addMessage({
      role: 'user',
      content: task,
    });

    // Main loop
    while (this.iterationCount < this.maxIterations) {
      const shouldContinue = await this.step();
      if (!shouldContinue) break;
      this.iterationCount++;
    }

    // End session
    await this.memory.endSession();
    this.ui.showSessionEnd();
  }

  private async step(): Promise<boolean> {
    // ═══════════════════════════════════════════════════════════
    // RECALL: Get relevant memories BEFORE the LLM call
    // ═══════════════════════════════════════════════════════════
    const lastMessage = this.memory.getLastMessage();
    let relevantMemories: RecalledMemory[] = [];

    if (lastMessage && lastMessage.role === 'user') {
      this.ui.showRecallStart();
      relevantMemories = await this.memory.recall(lastMessage.content);
      this.ui.showRecalledMemories(relevantMemories);
    }

    // Build context with memories
    const messages = await this.buildContext(relevantMemories);

    // Build tool definitions
    const toolDefinitions: ToolDefinition[] = Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // ═══════════════════════════════════════════════════════════
    // STREAM: Get Kimi's response
    // ═══════════════════════════════════════════════════════════
    const chunks: string[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const chunk of this.kimi.stream(messages, toolDefinitions)) {
      switch (chunk.type) {
        case 'token':
          this.ui.write(chunk.content || '');
          chunks.push(chunk.content || '');
          break;

        case 'tool_call':
          if (chunk.toolCall) {
            toolCalls.push(chunk.toolCall);
            this.ui.showToolCall(chunk.toolCall);
          }
          break;

        case 'done':
          if (chunks.length > 0) {
            await this.memory.addMessage({
              role: 'assistant',
              content: chunks.join(''),
              toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
            });
          }
          break;

        case 'error':
          this.ui.error(chunk.content || 'Unknown error');
          return false;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // ACT: Execute tool calls
    // ═══════════════════════════════════════════════════════════
    if (toolCalls.length === 0) {
      // No tools called - task complete
      this.ui.write('\n[Task complete]\n');
      return false;
    }

    for (const toolCall of toolCalls) {
      const tool = this.tools.get(toolCall.function.name);

      if (!tool) {
        this.ui.error(`Unknown tool: ${toolCall.function.name}`);
        await this.memory.addMessage({
          role: 'tool',
          toolCallId: toolCall.id,
          content: `Error: Unknown tool "${toolCall.function.name}"`,
        });
        continue;
      }

      // Parse arguments
      let args: any;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      // Execute tool
      this.ui.showToolExecuting(tool.name);
      const context: ToolContext = {
        cwd: this.cwd,
        sessionId: this.memory.getCurrentSession()?.id,
      };

      let result: string;
      const startTime = Date.now();

      try {
        if (tool.executeStream && this.shouldStream(tool.name)) {
          // Streaming execution for bash
          const parts: string[] = [];
          for await (const part of tool.executeStream(args, context)) {
            this.ui.writeToolOutput(part);
            parts.push(part);
          }
          result = parts.join('');
        } else {
          const res = await tool.execute(args, context);
          if (res.ok) {
            result = res.content;
            this.ui.showToolResult(tool.name, result);
          } else {
            result = `Error: ${res.error}`;
            this.ui.showToolError(tool.name, res.error);
          }
        }
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
        this.ui.showToolError(tool.name, result);
      }

      const duration = Date.now() - startTime;

      // Add tool result to working memory
      await this.memory.addMessage({
        role: 'tool',
        toolCallId: toolCall.id,
        content: result.substring(0, 8000), // Limit result size
      });

      // ═══════════════════════════════════════════════════════════
      // REMEMBER: Auto-record episode
      // ═══════════════════════════════════════════════════════════
      const outcomeType = result.startsWith('Error:') ? 'error' : 'success';
      await this.memory.recordEpisode(
        tool.name,
        `Tool call: ${tool.name} with args ${JSON.stringify(args)}`,
        result.substring(0, 1000),
        outcomeType,
        `Duration: ${duration}ms`
      );

      // Extract facts for successful operations
      if (outcomeType === 'success' && tool.name === 'edit') {
        await this.memory.extractAndStoreFacts(
          `Edited ${args.path}: ${result}`,
          'edit_tool'
        );
      }
    }

    return true;
  }

  private async buildContext(memories: RecalledMemory[]): Promise<Message[]> {
    const messages: Message[] = [];

    // Add system message with recalled memories
    let systemPrompt = this.getSystemPrompt();

    if (memories.length > 0) {
      const memoryContext = this.formatMemoriesForContext(memories);
      systemPrompt += '\n\n' + memoryContext;
    }

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Add conversation history
    const history = this.memory.getMessages();
    for (const msg of history.slice(1)) { // Skip first system message, we added our own
      messages.push({
        role: msg.role,
        content: msg.content,
        tool_calls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
        tool_call_id: msg.toolCallId,
      });
    }

    return messages;
  }

  private formatMemoriesForContext(memories: RecalledMemory[]): string {
    const lines: string[] = [];
    lines.push('=== RELEVANT MEMORIES ===');

    const episodes = memories.filter(m => m.type === 'episode');
    const facts = memories.filter(m => m.type === 'fact');
    const code = memories.filter(m => m.type === 'code' || m.type === 'file');

    if (facts.length > 0) {
      lines.push('\nKnown Facts:');
      for (const fact of facts.slice(0, 5)) {
        lines.push(`- ${fact.content}`);
      }
    }

    if (episodes.length > 0) {
      lines.push('\nPast Actions:');
      for (const ep of episodes.slice(0, 5)) {
        const date = ep.timestamp ? new Date(ep.timestamp).toLocaleDateString() : 'unknown';
        lines.push(`- [${date}] ${ep.content.split('\n')[0]}`);
      }
    }

    if (code.length > 0) {
      lines.push('\nRelevant Code:');
      for (const c of code.slice(0, 3)) {
        lines.push(`- ${c.source || 'unknown'}`);
      }
    }

    lines.push('=== END MEMORIES ===');
    return lines.join('\n');
  }

  private getSystemPrompt(): string {
    return `You are Horus, an intelligent coding assistant with memory.

CAPABILITIES:
- View files and directories
- Edit files with diff-based matching
- Execute bash commands
- Search code with ripgrep
- Access your memory of past actions and learned facts

MEMORY:
You have access to relevant memories before each response. Use them to:
- Avoid repeating mistakes
- Follow established patterns
- Understand the codebase context

TOOL USE:
- Always check the current state before making changes
- Prefer view then edit pattern
- Use bash for tests, builds, and git operations
- Confirm destructive operations are safe

Be concise but thorough. If you need more information, use the view or search tools.`;
  }

  private shouldStream(toolName: string): boolean {
    // Only stream bash output for now
    return toolName === 'bash';
  }
}
