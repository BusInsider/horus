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
import { Tracer } from './utils/tracer.js';
import { ContextCompactor, K2_6_TIER_BUDGETS } from './context-compactor.js';
import { ToolSelector } from './utils/tool-selector.js';

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
  turbo?: boolean;
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
  private turbo: boolean;
  private tracer: Tracer;
  private sessionStartTime: number = 0;
  private contextCompactor: ContextCompactor;
  private toolSelector: ToolSelector;
  private recentlyCalledTools: Set<string> = new Set();

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
    this.turbo = config.turbo ?? false;
    this.tracer = new Tracer('pending', true);
    const isK26 = this.kimi.getModel().includes('k2-6');
    this.contextCompactor = new ContextCompactor({
      enabled: process.env.HORUS_COMPACTION !== '0',
      budgets: isK26 ? K2_6_TIER_BUDGETS : undefined,
    });
    this.toolSelector = new ToolSelector({
      maxTools: 16,
      coreTools: ['view', 'edit', 'bash', 'search'],
    });

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

  async run(task: string, cwd: string, options?: { planMode?: boolean; resumeFromCheckpoint?: string; fresh?: boolean }): Promise<void> {
    this.cwd = cwd;
    this.iterationCount = 0;
    const usePlanMode = options?.planMode ?? this.planMode;

    // Check for crashed session (skip if --fresh flag is set)
    if (!options?.resumeFromCheckpoint && !options?.fresh) {
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

    // Initialize tracer with real session ID
    this.tracer = new Tracer(session!.id, true);
    this.sessionStartTime = Date.now();
    this.tracer.recordSessionStart(cwd, this.modeController.getMode(), this.turbo ? 'kimi-k2-turbo-preview' : (this.modeController.getModel() || 'default'));

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
      
      // Auto-extract memories from task completion
      await this.autoExtractTaskMemory(task);
      
    } finally {
      // Cleanup
      this.isRunning = false;
      this.sessionPersistence.stopAutoSave();
      await this.memory.endSession();
      this.ui.showSessionEnd();
      this.tracer.recordSessionEnd(Date.now() - this.sessionStartTime, this.iterationCount);
    }
  }

  /**
   * Extract memories from completed tasks
   */
  private async autoExtractTaskMemory(task: string): Promise<void> {
    const session = this.memory.getCurrentSession();
    if (!session) return;

    try {
      // Store the task itself as context
      await this.memory.storeFact(
        'task_history',
        `Completed task: ${task.substring(0, 500)}`,
        session.id,
        0.5
      );
      
      // Extract file patterns from task
      const fileMatches = task.match(/[\w\/\.-]+\.(ts|js|py|rs|go|java|rb)/g);
      if (fileMatches) {
        for (const file of [...new Set(fileMatches)].slice(0, 5)) {
          await this.memory.storeFact(
            'code',
            `Task referenced: ${file}`,
            session.id,
            0.6
          );
        }
      }
      
    } catch {
      // Best effort - ignore errors
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

    // Initialize tracer with real session ID
    this.tracer = new Tracer(session!.id, true);
    this.sessionStartTime = Date.now();
    this.tracer.recordSessionStart(cwd, this.modeController.getMode(), this.turbo ? 'kimi-k2-turbo-preview' : (this.modeController.getModel() || 'default'));

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
        
        if (this.ui.getVerbosity() !== 'quiet') {
          console.log(chalk.gray('[Sending to AI...]'));
        }
        
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
        
        // Auto-extract and store memories from this turn
        await this.autoExtractMemories(input);
        
        console.log(); // Add spacing between turns
      }
    } finally {
      // Cleanup
      this.sessionPersistence.stopAutoSave();
      await this.memory.endSession();
      this.ui.showSessionEnd();
      this.tracer.recordSessionEnd(Date.now() - this.sessionStartTime, this.iterationCount);
    }
  }

  /**
   * Automatically extract and store memories from conversation
   */
  private async autoExtractMemories(userInput: string): Promise<void> {
    const session = this.memory.getCurrentSession();
    if (!session) return;

    try {
      // Get recent messages for context
      const messages = this.memory.getMessages();
      const recentMessages = messages.slice(-6); // Last 6 messages
      
      // Extract potential facts from user input
      const facts = this.extractFactsFromInput(userInput);
      
      for (const fact of facts) {
        await this.memory.storeFact(
          fact.category,
          fact.content,
          session.id,
          fact.confidence
        );
        
        if (this.ui.getVerbosity() !== 'quiet') {
          console.log(chalk.gray(`[Auto-memory: ${fact.category}]`));
        }
      }
      
      // Extract facts from conversation context
      const validMessages = recentMessages
        .filter((m): m is typeof m & { content: string } => typeof m.content === 'string');
      const conversationFacts = this.extractFactsFromConversation(validMessages);
      
      for (const fact of conversationFacts) {
        await this.memory.storeFact(
          fact.category,
          fact.content,
          session.id,
          fact.confidence
        );
      }
      
    } catch (error) {
      // Silently fail - memory extraction is best-effort
      if (this.ui.getVerbosity() === 'verbose') {
        console.log(chalk.gray('[Memory extraction skipped]'));
      }
    }
  }

  /**
   * Extract facts from user input patterns
   */
  private extractFactsFromInput(input: string): Array<{category: string; content: string; confidence: number}> {
    const facts: Array<{category: string; content: string; confidence: number}> = [];
    const lower = input.toLowerCase();
    
    // Pattern: "my X is Y" or "I am Y" or "I like Y"
    const preferencePatterns = [
      { regex: /my (?:favorite|favourite) (\w+) is (.+)/i, category: 'preference' },
      { regex: /i (?:like|love|enjoy|prefer) (.+)/i, category: 'preference' },
      { regex: /i (?:dislike|hate|don't like) (.+)/i, category: 'preference' },
      { regex: /i am (?:a|an) (.+)/i, category: 'identity' },
      { regex: /i work (?:on|with|at) (.+)/i, category: 'work' },
      { regex: /my (\w+) (?:is|are) (.+)/i, category: 'personal' },
    ];
    
    for (const pattern of preferencePatterns) {
      const match = input.match(pattern.regex);
      if (match) {
        facts.push({
          category: pattern.category,
          content: match[0],
          confidence: 0.8,
        });
      }
    }
    
    // Project context patterns
    if (lower.includes('project') || lower.includes('repo') || lower.includes('codebase')) {
      facts.push({
        category: 'context',
        content: `Working on: ${input.substring(0, 200)}`,
        confidence: 0.6,
      });
    }
    
    return facts;
  }

  /**
   * Extract facts from conversation messages
   */
  private extractFactsFromConversation(messages: Array<{role: string; content: string}>): Array<{category: string; content: string; confidence: number}> {
    const facts: Array<{category: string; content: string; confidence: number}> = [];
    
    // Look for successful tool executions that reveal project structure
    const toolResults = messages.filter(m => m.role === 'tool');
    
    for (const result of toolResults) {
      // Extract file paths from tool results
      const pathMatches = result.content.match(/[\w\/\.-]+\.(ts|js|py|rs|go|java|rb)/g);
      if (pathMatches && pathMatches.length > 0) {
        // Store unique file paths as code context
        const uniquePaths = [...new Set(pathMatches)].slice(0, 3);
        for (const path of uniquePaths) {
          facts.push({
            category: 'code',
            content: `Project contains: ${path}`,
            confidence: 0.7,
          });
        }
      }
    }
    
    return facts;
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
        const session = this.memory.getCurrentSession();
        if (this.checkpointManager && session) {
          await this.checkpointManager.create(step.description, session.id);
        }
        
        // Also create session checkpoint
        if (session) {
          await this.sessionPersistence.createCheckpoint({
            sessionId: session.id,
            messages: this.memory.getMessages(),
            workingDirectory: this.cwd,
            currentPlan: plan,
            metadata: {
              iterationCount: this.iterationCount,
            },
          });
        }
      }

      // Execute step with error handling
      const success = await this.executeStepWithRecovery(step);
      
      if (!success) {
        this.ui.error(`Step failed: ${step.description}`);
        
        // Offer rollback
        if (step.checkpoint && this.checkpointManager) {
          this.ui.writeLine('\n↩️  Rolling back to checkpoint...');
          await this.checkpointManager.rollback();
        }
        
        break;
      }
    }

    // Clean up plan file
    await this.planManager!.delete();
  }

  private async runDirect(task: string): Promise<void> {
    this.isRunning = true;
    
    // Initialize checkpoint manager from memory if available
    if (!this.checkpointManager) {
      this.checkpointManager = this.memory.checkpointManager;
    }

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
    if (this.autoCheckpoint && this.checkpointManager) {
      const session = this.memory.getCurrentSession();
      if (session) {
        await this.checkpointManager.create('Initial state', session.id);
      }
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

    // STREAM
    const chunks: string[] = [];
    const reasoningChunks: string[] = [];
    const toolCalls: ToolCall[] = [];

    // Get mode configuration
    const modeConfig = this.modeController.getConfig();

    // On-demand tool discovery: select relevant tools instead of loading all ~20
    const toolContext = lastMessage?.content || '';
    const selectedTools = this.toolSelector.select(this.tools, toolContext, Array.from(this.recentlyCalledTools));
    this.recentlyCalledTools.clear(); // Reset for next turn
    const effectiveTools: ToolDefinition[] = selectedTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    // Log tool selection in verbose mode
    if (this.ui.getVerbosity() === 'verbose') {
      const allNames = Array.from(this.tools.keys());
      const selectedNames = selectedTools.map(t => t.name);
      const dropped = allNames.filter(n => !selectedNames.includes(n));
      if (dropped.length > 0) {
        console.log(chalk.gray(`[Tools: ${selectedNames.length}/${allNames.length} active — dropped: ${dropped.join(', ')}]`));
      }
    }

    this.ui.showApiStart(contextMessages.length);
    // Mode info shown in verbose mode only
    if (this.ui.getVerbosity() === 'verbose') {
      console.log(chalk.gray(`[Mode: ${modeConfig.name}, Temp: ${modeConfig.temperature}, Tools: ${effectiveTools.length} enabled]`));
    }

    const streamModel = this.turbo ? 'kimi-k2-turbo-preview' : (modeConfig.model || undefined);
    this.tracer.recordApiCall(contextMessages.length, effectiveTools.length, modeConfig.temperature, streamModel);

    let doneHandled = false;
    try {
      for await (const chunk of this.kimi.stream(contextMessages, effectiveTools, {
        temperature: modeConfig.temperature,
        maxTokens: modeConfig.maxTokens,
        thinking: modeConfig.thinking,
        topP: modeConfig.topP,
        model: streamModel,
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
              if (chunk.usage) {
                this.tracer.recordTokenUsage(chunk.usage.promptTokens, chunk.usage.completionTokens);
              }
              this.tracer.recordApiResponse(chunks.join(''), reasoningChunks.join(''), toolCalls.length);
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
      this.tracer.recordError(error instanceof Error ? error.message : 'Unknown API error', 'api_stream');
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
      if (toolCall.function.name === 'edit' && this.autoCheckpoint && this.checkpointManager) {
        const session = this.memory.getCurrentSession();
        if (session) {
          await this.checkpointManager.create(`After ${toolCall.function.name}`, session.id);
        }
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
    this.tracer.recordToolCall(tool.name, args);
    this.recentlyCalledTools.add(tool.name);
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
      const isError = result.startsWith('Error:');
      this.tracer.recordToolResult(tool.name, result, duration, isError);

      await this.memory.addMessage({
        role: 'tool',
        toolCallId: toolCall.id,
        content: result.substring(0, 8000),
      });

      const outcomeType = isError ? 'error' : 'success';
      await this.memory.recordEpisode(
        tool.name,
        `Tool call: ${tool.name} with args ${JSON.stringify(args)}`,
        result.substring(0, 1000),
        outcomeType,
        `Duration: ${duration}ms`
      );

    } catch (error) {
      this.tracer.recordError(error instanceof Error ? error.message : 'Unknown tool error', `tool:${tool.name}`);
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
    const allMessages = this.memory.getMessages();
    const task = this.memory.getLastMessage()?.content || '';

    const { messages, tierUsage, totalTokens } = await this.contextCompactor.buildContext({
      systemPrompt: this.getSystemPrompt(),
      messages: allMessages,
      memories,
      task,
      memory: this.memory,
      tokenManager: this.tokenManager,
      cwd: this.cwd,
    });

    // Update token manager with tier breakdown
    this.tokenManager.updateUsage({ messages: totalTokens });
    this.tokenManager.updateTierUsage(tierUsage);

    // Log tier breakdown in verbose mode
    if (this.ui.getVerbosity() === 'verbose') {
      const breakdown = this.tokenManager.getTierBreakdown();
      if (breakdown) {
        console.log(chalk.gray(`[Context tiers: ${breakdown}]`));
      }
    }

    return messages;
  }

  private getSystemPrompt(): string {
    // K2.6-optimized structured prompt (default since v0.2.1)
    // Set HORUS_LEGACY_PROMPT=1 to use the original minimal prompt
    if (process.env.HORUS_LEGACY_PROMPT === '1') {
      return this.getSystemPromptLegacy();
    }
    return this.getSystemPromptV2();
  }

  private getSystemPromptLegacy(): string {
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

  /**
   * K2.6-optimized system prompt variant.
   * More structured reasoning, explicit tool selection heuristics,
   * and structured output expectations for better long-context utilization.
   */
  private getSystemPromptV2(): string {
    return `You are Horus, an expert autonomous coding agent. Your goal is to complete tasks efficiently and correctly.

## Core Principles
1. **Statefulness**: You have memory of past actions. Use \`recall\` before repeating work.
2. **Safety**: Check current state with \`view\` or \`bash\` before modifying files.
3. **Minimalism**: Make the smallest correct change. Avoid unnecessary edits.
4. **Verification**: After changes, run tests or verify behavior.

## Tool Selection Heuristics
- **Need to find something?** Use \`search\` (ripgrep) first, not \`view\` on every file.
- **Need to read a file?** Use \`view\` for small files, \`cat\` for one-liners.
- **Need to change a file?** Use \`edit\` with exact diff matching. Provide enough context lines.
- **Need to run a command?** Use \`bash\`. Check working directory if unsure.
- **Need to remember something?** Use \`remember\` for facts, \`index\` for codebase knowledge.

## Error Recovery
If a tool fails:
1. Read the error carefully.
2. Do not guess. Use \`view\` or \`search\` to understand the actual state.
3. Fix the root cause, not the symptom.
4. Verify the fix works.

## Reasoning Style
Think step-by-step internally (reasoning_content), then produce concise external responses. Avoid rambling. Focus on action.`;
  }

  private shouldStream(toolName: string): boolean {
    return toolName === 'bash';
  }
}
