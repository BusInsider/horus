// Enhanced Agent with Plan Mode, Checkpoints, and Subagents
// Hermes-equivalent flexibility

import { KimiClient, Message, ToolDefinition, ToolCall } from './kimi.js';
import { MemoryManager, RecalledMemory } from './memory/manager.js';
import { Tool, ToolContext } from './tools/types.js';
import { TerminalUI } from './ui/terminal.js';
import { PlanManager, Plan, PlanStep } from './plan.js';
import { CheckpointManager } from './checkpoint.js';
import { SubagentManager, SubagentTask } from './subagent.js';

export interface EnhancedAgentConfig {
  kimi: KimiClient;
  memory: MemoryManager;
  tools: Map<string, Tool>;
  ui: TerminalUI;
  maxIterations?: number;
  autoCheckpoint?: boolean;
  planMode?: boolean;
}

export class EnhancedAgent {
  private kimi: KimiClient;
  private memory: MemoryManager;
  private tools: Map<string, Tool>;
  private ui: TerminalUI;
  private maxIterations: number;
  private autoCheckpoint: boolean;
  private planMode: boolean;
  private iterationCount: number = 0;
  private cwd: string = '';
  private planManager?: PlanManager;
  private checkpointManager?: CheckpointManager;
  private subagentManager?: SubagentManager;

  constructor(config: EnhancedAgentConfig) {
    this.kimi = config.kimi;
    this.memory = config.memory;
    this.tools = config.tools;
    this.ui = config.ui;
    this.maxIterations = config.maxIterations || 50;
    this.autoCheckpoint = config.autoCheckpoint ?? true;
    this.planMode = config.planMode ?? false;
  }

  async run(task: string, cwd: string, options?: { planMode?: boolean }): Promise<void> {
    this.cwd = cwd;
    this.iterationCount = 0;
    const usePlanMode = options?.planMode ?? this.planMode;

    // Start or resume session
    await this.memory.startSession(cwd);
    const session = this.memory.getCurrentSession();
    this.ui.showSessionStart(session!.id, cwd);

    // Initialize managers
    this.checkpointManager = this.memory.checkpointManager;
    this.subagentManager = this.memory.subagentManager;
    this.planManager = new PlanManager(cwd);

    // Index workspace
    this.ui.showIndexingStart();
    const indexResult = await this.memory.indexWorkspace(cwd);
    this.ui.showIndexingComplete(indexResult.files, indexResult.chunks);

    // PLAN MODE: Generate and execute plan
    if (usePlanMode) {
      await this.runWithPlan(task);
    } else {
      // DIRECT MODE: Execute task directly
      await this.runDirect(task);
    }

    // End session
    await this.memory.endSession();
    this.ui.showSessionEnd();
  }

  private async runWithPlan(objective: string): Promise<void> {
    // Generate plan
    this.ui.writeLine('\n📝 Generating plan...\n');
    const plan = await this.generatePlan(objective);
    
    // Write plan to file
    await this.planManager!.writePlan(plan);
    this.ui.writeLine(`\n✅ Plan written to ${this.cwd}/PLAN.md`);
    this.ui.writeLine(`\n${plan.steps.length} steps, estimated ${plan.estimatedTokens} tokens`);
    
    // In real implementation, wait for user approval here
    // For now, auto-execute
    this.ui.writeLine('\n▶️  Executing plan...\n');

    // Execute each step
    for (const step of plan.steps) {
      // Create checkpoint if needed
      if (step.checkpoint && this.autoCheckpoint) {
        this.ui.writeLine(`\n💾 Creating checkpoint: ${step.description}`);
        await this.checkpointManager!.create(step.description, this.memory.getCurrentSession()!.id);
      }

      // Execute step
      const success = await this.executeStep(step);
      
      if (!success) {
        this.ui.error(`Step failed: ${step.description}`);
        
        // Offer rollback
        if (step.checkpoint) {
          this.ui.writeLine('\n↩️  Rolling back to checkpoint...');
          await this.checkpointManager!.rollback();
        }
        
        break;
      }
    }

    // Clean up plan file
    await this.planManager!.delete();
  }

  private async runDirect(task: string): Promise<void> {
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

    // Create initial checkpoint if auto-checkpoint enabled
    if (this.autoCheckpoint) {
      await this.checkpointManager!.create('Initial state', this.memory.getCurrentSession()!.id);
    }

    // Main loop
    while (this.iterationCount < this.maxIterations) {
      const shouldContinue = await this.step();
      if (!shouldContinue) break;
      this.iterationCount++;
    }
  }

  private async generatePlan(objective: string): Promise<Plan> {
    // Use LLM to generate plan
    const prompt = `You are an expert software architect. Break down this task into specific steps.

Task: ${objective}

Create a plan with:
1. 3-10 specific steps
2. Each step uses ONE tool only
3. Mark critical steps that need checkpoints
4. Include estimated token usage

Return JSON:
{
  "steps": [
    {"id": "1", "description": "...", "tool": "view", "args": {...}, "checkpoint": true}
  ],
  "estimatedTokens": 15000
}`;

    const response = await this.kimi.complete([
      { role: 'user', content: prompt }
    ]);

    try {
      const parsed = JSON.parse(response);
      return {
        objective,
        context: `Working directory: ${this.cwd}`,
        steps: parsed.steps,
        estimatedTokens: parsed.estimatedTokens || 10000,
        rollbackStrategy: 'Each checkpoint creates a git commit. Rollback with checkpoint tool.',
      };
    } catch {
      // Fallback to basic plan
      return {
        objective,
        context: `Working directory: ${this.cwd}`,
        steps: [
          { id: '1', description: 'Analyze current state', tool: 'view', args: { path: '.' }, checkpoint: true },
          { id: '2', description: 'Execute task', tool: 'bash', args: { command: 'echo "Task execution"' }, checkpoint: false },
        ],
        estimatedTokens: 5000,
        rollbackStrategy: 'Manual rollback if needed',
      };
    }
  }

  private async executeStep(step: PlanStep): Promise<boolean> {
    this.ui.writeLine(`\n📍 Step ${step.id}: ${step.description}`);

    const tool = this.tools.get(step.tool);
    if (!tool) {
      this.ui.error(`Unknown tool: ${step.tool}`);
      return false;
    }

    try {
      const context: ToolContext = {
        cwd: this.cwd,
        sessionId: this.memory.getCurrentSession()?.id,
      };

      const result = await tool.execute(step.args, context);
      
      if (result.ok) {
        this.ui.showToolResult(step.tool, result.content);
        return true;
      } else {
        this.ui.showToolError(step.tool, result.error);
        return false;
      }
    } catch (error) {
      this.ui.showToolError(step.tool, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  private async step(): Promise<boolean> {
    // RECALL
    const lastMessage = this.memory.getLastMessage();
    let relevantMemories: RecalledMemory[] = [];

    if (lastMessage && lastMessage.role === 'user') {
      this.ui.showRecallStart();
      relevantMemories = await this.memory.recall(lastMessage.content);
      this.ui.showRecalledMemories(relevantMemories);
    }

    // Build context
    const messages = await this.buildContext(relevantMemories);
    const toolDefinitions: ToolDefinition[] = Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // STREAM
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
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
          break;

        case 'error':
          this.ui.error(chunk.content || 'Unknown error');
          return false;
      }
    }

    // ACT
    if (toolCalls.length === 0) {
      this.ui.write('\n[Task complete]\n');
      return false;
    }

    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      
      // Auto-checkpoint on edit operations
      if (toolCall.function.name === 'edit' && this.autoCheckpoint) {
        await this.checkpointManager!.create(`After ${toolCall.function.name}`, this.memory.getCurrentSession()!.id);
      }

      if (!result) return false;
    }

    return true;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<boolean> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      this.ui.error(`Unknown tool: ${toolCall.function.name}`);
      await this.memory.addMessage({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: Unknown tool "${toolCall.function.name}"`,
      });
      return false;
    }

    let args: any;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      args = {};
    }

    this.ui.showToolExecuting(tool.name);
    const context: ToolContext = {
      cwd: this.cwd,
      sessionId: this.memory.getCurrentSession()?.id,
    };

    let result: string;
    const startTime = Date.now();

    try {
      if (tool.executeStream && this.shouldStream(tool.name)) {
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

    await this.memory.addMessage({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.substring(0, 8000),
    });

    const outcomeType = result.startsWith('Error:') ? 'error' : 'success';
    await this.memory.recordEpisode(
      tool.name,
      `Tool call: ${tool.name} with args ${JSON.stringify(args)}`,
      result.substring(0, 1000),
      outcomeType,
      `Duration: ${duration}ms`
    );

    return outcomeType === 'success';
  }

  private async buildContext(memories: RecalledMemory[]): Promise<Message[]> {
    const messages: Message[] = [];

    let systemPrompt = this.getSystemPrompt();

    if (memories.length > 0) {
      const memoryContext = this.formatMemoriesForContext(memories);
      systemPrompt += '\n\n' + memoryContext;
    }

    messages.push({
      role: 'system',
      content: systemPrompt,
    });

    const history = this.memory.getMessages();
    for (const msg of history.slice(1)) {
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
    return `You are Horus, an intelligent coding assistant with memory and planning capabilities.

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

PLAN MODE:
When in plan mode, you follow a structured plan with checkpoints.

Be concise but thorough. Use tools proactively. Check state before changes.`;
  }

  private shouldStream(toolName: string): boolean {
    return toolName === 'bash';
  }
}
