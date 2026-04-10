// Enhanced Agent with Plan Mode, Checkpoints, Subagents, and Stability Features
// Hermes-equivalent flexibility with error recovery, token management, and persistence
// Kimi-native: Four-mode system (instant/thinking/agent/swarm)

import chalk from 'chalk';
import { KimiClient, Message, ToolDefinition, ToolCall } from './kimi.js';
import { MemoryManager, RecalledMemory } from './memory/manager.js';
import { Tool, ToolContext } from './tools/types.js';
import { TerminalUI } from './ui/terminal.js';
import { PlanManager, Plan, PlanStep } from './plan.js';
import { CheckpointManager } from './checkpoint.js';
// import { SubagentManager } from './subagent.js';
import { ErrorHandler, getErrorHandler } from './error-handler.js';
import { TokenManager, getTokenManager } from './token-manager.js';
import { SessionPersistence, getSessionPersistence } from './session-persistence.js';
import { Logger } from './utils/logger.js';
import { ModeController, ModeType, getModeController } from './mode-controller.js';
import { ContextLoader, estimateProjectSize } from './context-loader.js';

export interface EnhancedAgentConfig {
  kimi: KimiClient;
  memory: MemoryManager;
  tools: Map<string, Tool>;
  ui: TerminalUI;
  maxIterations?: number;
  autoCheckpoint?: boolean;
  planMode?: boolean;
  logger?: Logger;
  mode?: ModeType;
  showThinking?: boolean;
}

export class EnhancedAgent {
  private kimi: KimiClient;
  private memory: MemoryManager;
  private tools: Map<string, Tool>;
  private ui: TerminalUI;
  private maxIterations: number;
  private autoCheckpoint: boolean;
  private planMode: boolean;
  private modeController: ModeController;
  private showThinking: boolean;
  private iterationCount: number = 0;
  private cwd: string = '';
  private planManager?: PlanManager;
  private checkpointManager?: CheckpointManager;
  private errorHandler: ErrorHandler;
  private tokenManager: TokenManager;
  private sessionPersistence: SessionPersistence;
  private logger: Logger;
  private isRunning: boolean = false;

  constructor(config: EnhancedAgentConfig) {
    this.kimi = config.kimi;
    this.memory = config.memory;
    this.tools = config.tools;
    this.ui = config.ui;
    this.maxIterations = config.maxIterations || 50;
    this.autoCheckpoint = config.autoCheckpoint ?? true;
    this.planMode = config.planMode ?? false;
    this.logger = config.logger || new Logger('agent');
    this.showThinking = config.showThinking ?? false;
    
    // Initialize mode controller
    this.modeController = getModeController();
    if (config.mode) {
      this.modeController.setMode(config.mode);
    }
    
    // Initialize stability components
    this.errorHandler = getErrorHandler(this.logger);
    this.tokenManager = getTokenManager({}, this.logger);
    this.sessionPersistence = getSessionPersistence({}, this.logger);
  }

  async run(task: string, cwd: string, options?: { planMode?: boolean; resumeFromCheckpoint?: string }): Promise<void> {
    this.cwd = cwd;
    this.iterationCount = 0;
    const usePlanMode = options?.planMode ?? this.planMode;

    // Check for crashed session
    if (!options?.resumeFromCheckpoint) {
      const crashedSession = await this.sessionPersistence.checkForCrashedSession();
      if (crashedSession) {
        const resume = await this.askYesNo(`Found crashed session from ${new Date(crashedSession.timestamp).toLocaleString()}. Resume?`, true);
        if (resume) {
          return this.resumeFromCheckpoint(crashedSession.id);
        }
      }
    }

    // Start or resume session
    await this.memory.startSession(cwd);
    const session = this.memory.getCurrentSession();
    this.ui.showSessionStart(session!.id, cwd);

    // Initialize managers
    this.checkpointManager = this.memory.checkpointManager;

    this.planManager = new PlanManager(cwd);

    // Initialize session persistence
    await this.sessionPersistence.initialize();

    // Index workspace
    this.ui.showIndexingStart();
    const indexResult = await this.memory.indexWorkspace(cwd);
    this.ui.showIndexingComplete(indexResult.files, indexResult.chunks);

    // Start auto-save
    this.startAutoSave();

    try {
      // PLAN MODE: Generate and execute plan
      if (usePlanMode) {
        await this.runWithPlan(task);
      } else {
        // DIRECT MODE: Execute task directly
        await this.runDirect(task);
      }
    } finally {
      // Cleanup
      this.isRunning = false;
      this.sessionPersistence.stopAutoSave();
      await this.memory.endSession();
      this.ui.showSessionEnd();
    }
  }

  /**
   * Interactive chat mode - keeps session alive between messages
   */
  async chat(cwd: string, getInput: () => Promise<string>): Promise<void> {
    this.cwd = cwd;
    this.iterationCount = 0;

    // Start session once
    await this.memory.startSession(cwd);
    const session = this.memory.getCurrentSession();
    this.ui.showSessionStart(session!.id, cwd);

    // Initialize managers
    this.checkpointManager = this.memory.checkpointManager;
    this.planManager = new PlanManager(cwd);
    await this.sessionPersistence.initialize();

    // Index workspace once
    this.ui.showIndexingStart();
    const indexResult = await this.memory.indexWorkspace(cwd);
    this.ui.showIndexingComplete(indexResult.files, indexResult.chunks);

    // Add system prompt once
    await this.memory.addMessage({
      role: 'system',
      content: this.getSystemPrompt(),
    });

    // Start auto-save
    this.startAutoSave();

    try {
      // Chat loop
      while (true) {
        const input = await getInput();
        
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          break;
        }
        
        if (!input.trim()) {
          continue;
        }

        // Add user message
        await this.memory.addMessage({
          role: 'user',
          content: input,
        });

        // Process with AI (single step for chat)
        this.isRunning = true;
        this.iterationCount = 0; // Reset for each message
        
        console.log(chalk.gray('[Sending to AI...]'));
        
        try {
          while (this.isRunning && this.iterationCount < this.maxIterations) {
            const shouldContinue = await this.step();
            if (!shouldContinue) break;
            this.iterationCount++;
          }
        } catch (error) {
          this.ui.error(error instanceof Error ? error.message : 'Unknown error');
        }
        
        this.isRunning = false;
        console.log(); // Add spacing between turns
      }
    } finally {
      // Cleanup
      this.sessionPersistence.stopAutoSave();
      await this.memory.endSession();
      this.ui.showSessionEnd();
    }
  }

  private async resumeFromCheckpoint(checkpointId: string): Promise<void> {
    const result = await this.sessionPersistence.resumeFromCheckpoint(checkpointId);
    
    if (!result.success || !result.checkpoint) {
      this.ui.error(`Failed to resume: ${result.error}`);
      return;
    }

    const checkpoint = result.checkpoint;
    this.cwd = checkpoint.workingDirectory;
    this.iterationCount = checkpoint.metadata.iterationCount;

    // Restore session
    await this.memory.startSession(this.cwd, checkpoint.sessionId);
    this.ui.showSessionStart(checkpoint.sessionId, this.cwd);
    this.ui.writeLine(`\n🔄 Resumed from checkpoint (iteration ${this.iterationCount})\n`);

    // Continue execution
    await this.runDirect('Continue from where we left off');
  }

  private startAutoSave(): void {
    const sessionId = this.memory.getCurrentSession()?.id;
    if (!sessionId) return;

    this.sessionPersistence.startAutoSave(sessionId, () => ({
      sessionId,
      messages: this.memory.getMessages(),
      workingDirectory: this.cwd,
      metadata: {
        iterationCount: this.iterationCount,
      },
    }));
  }

  private async askYesNo(_question: string, defaultValue: boolean = false): Promise<boolean> {
    // Simple implementation - in real UI would use proper prompt
    return defaultValue;
  }

  private async runWithPlan(objective: string): Promise<void> {
    // Generate plan
    this.ui.writeLine('\n📝 Generating plan...\n');
    const plan = await this.generatePlan(objective);
    
    // Check token budget
    const validation = this.tokenManager.validateContextSize([
      { role: 'user', content: objective },
    ]);
    if (!validation.valid) {
      this.ui.warn(`Token warning: ${validation.reason}`);
    }
    
    // Write plan to file
    await this.planManager!.writePlan(plan);
    this.ui.writeLine(`\n✅ Plan written to ${this.cwd}/PLAN.md`);
    this.ui.writeLine(`\n${plan.steps.length} steps, estimated ${plan.estimatedTokens} tokens`);
    
    // Show token usage
    this.tokenManager.updateUsage({ messages: plan.estimatedTokens });
    this.logTokenUsage();
    
    this.ui.writeLine('\n▶️  Executing plan...\n');

    // Execute each step
    for (const step of plan.steps) {
      // Check tokens before step
      if (this.tokenManager.shouldCompress()) {
        this.ui.warn('Token limit approaching, compressing context...');
        await this.compressContext();
      }

      // Create checkpoint if needed
      if (step.checkpoint && this.autoCheckpoint) {
        this.ui.writeLine(`\n💾 Creating checkpoint: ${step.description}`);
        await this.checkpointManager!.create(step.description, this.memory.getCurrentSession()!.id);
        
        // Also create session checkpoint
        await this.sessionPersistence.createCheckpoint({
          sessionId: this.memory.getCurrentSession()!.id,
          messages: this.memory.getMessages(),
          workingDirectory: this.cwd,
          currentPlan: plan,
          metadata: {
            iterationCount: this.iterationCount,
          },
        });
      }

      // Execute step with error handling
      const success = await this.executeStepWithRecovery(step);
      
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
    this.isRunning = true;

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

    // Main loop with error recovery
    while (this.isRunning && this.iterationCount < this.maxIterations) {
      try {
        const shouldContinue = await this.step();
        if (!shouldContinue) break;
        this.iterationCount++;
        
        // Reset retry count on successful step
        this.errorHandler.resetRetryCount('step');
        
      } catch (error) {
        const recovery = await this.errorHandler.handle(error as Error, {
          operation: 'step',
          sessionId: this.memory.getCurrentSession()?.id,
          recoverable: true,
        });

        if (recovery.recovered) {
          if (recovery.result?.action === 'compress_context') {
            await this.compressContext();
          } else if (recovery.result?.action === 'compress_memory') {
            await this.memory.compressOldestMessages?.();
          }
          // Retry the step
          continue;
        } else {
          this.ui.error('Unrecoverable error, stopping...');
          break;
        }
      }
    }
  }

  private async step(): Promise<boolean> {
    // Check token usage
    const messages = this.memory.getMessages();
    const messageTokens = this.tokenManager.estimateMessages(messages);
    this.tokenManager.updateUsage({ messages: messageTokens });

    // Warn if approaching limit
    if (this.tokenManager.shouldWarn()) {
      this.ui.warn(`Token usage: ${(this.tokenManager.getUsagePercentage() * 100).toFixed(0)}%`);
    }

    // Compress if needed
    if (this.tokenManager.shouldCompress()) {
      this.ui.warn('Token limit approaching, compressing context...');
      await this.compressContext();
    }

    // RECALL
    const lastMessage = this.memory.getLastMessage();
    let relevantMemories: RecalledMemory[] = [];

    if (lastMessage && lastMessage.role === 'user' && lastMessage.content) {
      this.ui.showRecallStart();
      relevantMemories = await this.memory.recall(lastMessage.content);
      this.ui.showRecalledMemories(relevantMemories);
    }

    // Build context
    const contextMessages = await this.buildContext(relevantMemories);
    
    // Validate context size
    const validation = this.tokenManager.validateContextSize(contextMessages);
    if (!validation.valid) {
      this.ui.warn(`Context too large: ${validation.reason}`);
      await this.compressContext();
    }

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
    const reasoningChunks: string[] = [];
    const toolCalls: ToolCall[] = [];

    // Get mode configuration
    const modeConfig = this.modeController.getConfig();
    // Tools are ALWAYS enabled in all modes - the harness never kneecaps the agent
    const effectiveTools = toolDefinitions;

    console.log(chalk.gray(`[Calling API with ${contextMessages.length} messages...]`));
    console.log(chalk.gray(`[Mode: ${modeConfig.name}, Temp: ${modeConfig.temperature}, Tools: ${effectiveTools.length} enabled]`));

    let doneHandled = false;
    try {
      for await (const chunk of this.kimi.stream(contextMessages, effectiveTools, {
        temperature: modeConfig.temperature,
        maxTokens: modeConfig.maxTokens,
        thinking: modeConfig.thinking,
        topP: modeConfig.topP,
      })) {
        switch (chunk.type) {
          case 'token':
            this.ui.write(chunk.content || '');
            chunks.push(chunk.content || '');
            break;

          case 'reasoning':
            // Kimi's chain-of-thought (only shown in thinking/agent modes)
            reasoningChunks.push(chunk.content || '');
            // Display thinking if --show-thinking flag is set
            if (this.showThinking) {
              this.ui.writeThinking(chunk.content || '');
            }
            break;

          case 'tool_call':
            if (chunk.toolCall) {
              toolCalls.push(chunk.toolCall);
              this.ui.showToolCall(chunk.toolCall);
            }
            break;

          case 'done':
            if (!doneHandled) {
              doneHandled = true;
              if (chunks.length > 0 || toolCalls.length > 0) {
                await this.memory.addMessage({
                  role: 'assistant',
                  content: chunks.join(''),
                  toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : undefined,
                  reasoningContent: reasoningChunks.join('') || (toolCalls.length > 0 ? '[Thinking about tool usage...]' : undefined),
                });
              } else {
                console.log(chalk.yellow('[No content received from API]'));
              }
            }
            break;

          case 'error':
            throw new Error(chunk.content || 'Unknown API error');
        }
      }
    } catch (error) {
      // Let error handler deal with API errors
      throw error;
    }

    // ACT
    if (toolCalls.length === 0) {
      this.ui.write('\n[Task complete]\n');
      return false;
    }

    for (const toolCall of toolCalls) {
      await this.executeToolCallWithRecovery(toolCall);
      
      // Auto-checkpoint on edit operations
      if (toolCall.function.name === 'edit' && this.autoCheckpoint) {
        await this.checkpointManager!.create(`After ${toolCall.function.name}`, this.memory.getCurrentSession()!.id);
      }
    }

    // Continue the conversation loop so AI can see tool results/errors
    return true;
  }

  private async executeStepWithRecovery(step: PlanStep): Promise<boolean> {
    const context: ToolContext = {
      cwd: this.cwd,
      sessionId: this.memory.getCurrentSession()?.id,
    };

    try {
      const tool = this.tools.get(step.tool);
      if (!tool) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }

      const result = await tool.execute(step.args, context);
      
      if (result.ok) {
        this.ui.showToolResult(step.tool, result.content);
        return true;
      } else {
        this.ui.showToolError(step.tool, result.error);
        return false;
      }
    } catch (error) {
      const recovery = await this.errorHandler.handle(error as Error, {
        operation: 'executeStep',
        tool: step.tool,
        sessionId: this.memory.getCurrentSession()?.id,
        recoverable: true,
      });

      if (recovery.recovered) {
        // Retry the step
        return this.executeStepWithRecovery(step);
      }

      return false;
    }
  }

  private async executeToolCallWithRecovery(toolCall: ToolCall): Promise<void> {
    const tool = this.tools.get(toolCall.function.name);
    if (!tool) {
      this.ui.error(`Unknown tool: ${toolCall.function.name}`);
      await this.memory.addMessage({
        role: 'tool',
        toolCallId: toolCall.id,
        content: `Error: Unknown tool "${toolCall.function.name}"`,
      });
      return;
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }

    this.ui.showToolExecuting(tool.name);
    const context: ToolContext = {
      cwd: this.cwd,
      sessionId: this.memory.getCurrentSession()?.id,
    };

    try {
      let result: string;
      const startTime = Date.now();

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

      const duration = Date.now() - startTime;

      await this.memory.addMessage({
        role: 'tool',
        toolCallId: toolCall.id,
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

    } catch (error) {
      const recovery = await this.errorHandler.handle(error as Error, {
        operation: 'executeToolCall',
        tool: tool.name,
        sessionId: this.memory.getCurrentSession()?.id,
        recoverable: true,
      });

      if (recovery.recovered) {
        // Retry the tool call
        return this.executeToolCallWithRecovery(toolCall);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.memory.addMessage({
        role: 'tool',
        toolCallId: toolCall.id,
        content: `Error: ${errorMessage}`,
      });
    }
  }

  private async compressContext(): Promise<void> {
    const messages = this.memory.getMessages();
    const target = this.tokenManager.getCompressionTarget();
    const toCompress = this.tokenManager.suggestMessagesToCompress(messages, target.currentTokens - target.targetTokens);
    
    if (toCompress > 0) {
      this.ui.writeLine(`\n[Compressing ${toCompress} messages to save tokens...]`);
      await this.memory.compressOldestMessages?.();
    }
  }

  private logTokenUsage(): void {
    const usage = this.tokenManager.getUsage();
    this.logger.debug('Token usage:', usage);
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
      const content = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(content);
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

  private async buildContext(memories: RecalledMemory[]): Promise<Message[]> {
    const messages: Message[] = [];

    let systemPrompt = this.getSystemPrompt();

    // Check if we should load full codebase into context (Kimi 256K optimization)
    const projectEstimate = await estimateProjectSize(this.cwd);
    if (projectEstimate.fitsInContext && projectEstimate.fileCount > 0) {
      console.log(chalk.gray(`[Loading ${projectEstimate.fileCount} files (${Math.round(projectEstimate.estimatedTokens/1000)}K tokens) into context...]`));
      const loader = new ContextLoader({ rootPath: this.cwd });
      const { files, totalTokens, truncated } = await loader.loadContext();
      if (files.length > 0) {
        const codebaseContext = loader.formatForContext(files);
        systemPrompt += '\n\n' + codebaseContext;
        console.log(chalk.gray(`[Context loaded: ${files.length} files, ~${Math.round(totalTokens/1000)}K tokens${truncated ? ', truncated' : ''}]`));
      }
    }

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
        reasoning_content: msg.reasoningContent,
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

Be concise but thorough. Use tools proactively. Check state before changes.`;
  }

  private shouldStream(toolName: string): boolean {
    return toolName === 'bash';
  }
}
