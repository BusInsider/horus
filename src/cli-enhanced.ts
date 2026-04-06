#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, getConfigPath, saveConfig, Config } from './config.js';
import { KimiClient } from './kimi.js';
import { MemoryManager } from './memory/manager.js';
import { EnhancedAgent } from './agent-enhanced.js';
import { TerminalUI } from './ui/terminal.js';
import {
  viewTool,
  editTool,
  bashTool,
  searchTool,
  globTool,
  createRecallTool,
  createRememberTool,
  createIndexWorkspaceTool,
} from './tools/index.js';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { expandHomeDir } from './utils/paths.js';
import { SubagentConfig } from './subagent.js';
import { PlanManager } from './plan.js';
import { handleAgentCommand, printAgentHelp } from './agents/index.js';
import { Logger, initLogger } from './utils/logger.js';
import { runConfigureWizard, showConfiguration, testApiConnection, resetConfiguration, configureMcp } from './configure.js';
import { runDoctor } from './doctor.js';
import chalk from 'chalk';

// Global state for CLI options
let globalOptions = {
  verbose: false,
  quiet: false,
  debug: false,
  dryRun: false,
};

const program = new Command();

program
  .name('horus')
  .description('Hermes-equivalent autonomous agent for Kimi K2.5')
  .version('0.2.0')
  .option('-v, --verbose', 'enable verbose output', false)
  .option('-q, --quiet', 'suppress non-error output', false)
  .option('--debug', 'enable debug mode with detailed logging', false)
  .option('--dry-run', 'show what would be done without executing', false)
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    globalOptions = {
      verbose: opts.verbose || false,
      quiet: opts.quiet || false,
      debug: opts.debug || false,
      dryRun: opts.dryRun || false,
    };

    // Initialize logger with appropriate level
    if (globalOptions.debug) {
      initLogger('debug');
    } else if (globalOptions.verbose) {
      initLogger('info');
    } else if (globalOptions.quiet) {
      initLogger('error');
    }

    // Warn about dry-run
    if (globalOptions.dryRun) {
      console.log(chalk.yellow('🔍 DRY RUN MODE: No changes will be made\n'));
    }
  });

program
  .command('init')
  .description('Initialize Horus configuration (interactive wizard)')
  .action(async () => {
    const configPath = getConfigPath();
    
    if (existsSync(configPath)) {
      const overwrite = await askYesNo('Configuration already exists. Reconfigure?', false);
      if (!overwrite) {
        console.log('Keeping existing configuration.');
        return;
      }
    }

    await runConfigureWizard();
  });

program
  .command('doctor')
  .description('Run diagnostic checks on Horus installation')
  .action(async () => {
    await runDoctor();
  });

program
  .command('chat [path]')
  .description('Start an interactive chat session')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .option('-p, --plan', 'Enable plan mode')
  .option('-n, --name <name>', 'Name this session for later reference')
  .option('--tag <tags>', 'Comma-separated tags for this session')
  .action(async (path, options) => {
    const config = loadConfig();
    const cwd = resolve(path || expandHomeDir(config.workspace.defaultPath));
    
    if (!existsSync(cwd)) {
      console.error(`Path not found: ${cwd}`);
      process.exit(1);
    }

    if (!config.provider.apiKey) {
      console.error('Error: KIMI_API_KEY not set. Run `horus init` and edit the config.');
      process.exit(1);
    }

    const ui = new TerminalUI();
    
    try {
      const kimi = new KimiClient({
        apiKey: config.provider.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
      });

      const subagentConfig: SubagentConfig = {
        db: {} as any, // Will be set after memory init
        horusPath: process.argv[1],
        maxConcurrent: 5,
        defaultTimeout: 300,
      };

      const memory = new MemoryManager({
        dbPath: config.memory.dbPath,
        embeddingModel: config.memory.embeddingModel,
        maxWorkingTokens: config.memory.maxWorkingTokens,
        recallThreshold: config.memory.recallThreshold,
        maxRecalledMemories: config.memory.maxRecalledMemories,
      }, subagentConfig);

      await memory.initialize();
      subagentConfig.db = memory['db'];

      const tools = new Map([
        ['view', viewTool],
        ['edit', editTool],
        ['bash', bashTool],
        ['search', searchTool],
        ['glob', globTool],
        ['recall', createRecallTool(memory)],
        ['remember', createRememberTool(memory)],
        ['index', createIndexWorkspaceTool(memory)],
      ]);

      const agent = new EnhancedAgent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
        autoCheckpoint: true,
        planMode: options.plan,
      });

      console.log(chalk.blue('\n🧠 Horus is ready. Type your task or "exit" to quit.\n'));
      if (options.plan) {
        console.log(chalk.yellow('📋 Plan mode enabled\n'));
      }

      // Interactive loop
      while (true) {
        const input = await ui.prompt('>');
        
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          break;
        }

        if (!input.trim()) {
          continue;
        }

        // Handle special commands
        if (input.startsWith('/agent')) {
          const args = input.slice(6).trim().split(' ').filter(Boolean);
          if (args.length === 0) {
            printAgentHelp();
          } else {
            await handleAgentCommand(args);
          }
          continue;
        }

        if (input.startsWith('/checkpoint')) {
          await handleCheckpointCommand(input, memory, ui);
          continue;
        }

        if (input.startsWith('/rollback')) {
          await handleRollbackCommand(input, memory, ui);
          continue;
        }

        if (input.startsWith('/task')) {
          await handleTaskCommand(input, memory, ui);
          continue;
        }

        if (input.startsWith('/plan')) {
          await agent.run(input.slice(5).trim() || 'Create a plan', cwd, { planMode: true });
          continue;
        }

        try {
          await agent.run(input, cwd);
        } catch (error) {
          ui.error(error instanceof Error ? error.message : 'Unknown error');
        }

        console.log();
      }

      ui.close();
      memory.close();
      
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'Failed to start Horus');
      process.exit(1);
    }
  });

program
  .command('run <task>')
  .description('Execute a single task and exit')
  .option('-p, --path <path>', 'Working directory')
  .option('--plan', 'Use plan mode')
  .action(async (task, options) => {
    const config = loadConfig();
    const cwd = resolve(options.path || expandHomeDir(config.workspace.defaultPath));
    
    if (!existsSync(cwd)) {
      console.error(`Path not found: ${cwd}`);
      process.exit(1);
    }

    if (!config.provider.apiKey) {
      console.error('Error: KIMI_API_KEY not set');
      process.exit(1);
    }

    const ui = new TerminalUI();
    
    try {
      const kimi = new KimiClient({
        apiKey: config.provider.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
      });

      const subagentConfig: SubagentConfig = {
        db: {} as any,
        horusPath: process.argv[1],
        maxConcurrent: 5,
        defaultTimeout: 300,
      };

      const memory = new MemoryManager({
        dbPath: config.memory.dbPath,
        embeddingModel: config.memory.embeddingModel,
        maxWorkingTokens: config.memory.maxWorkingTokens,
        recallThreshold: config.memory.recallThreshold,
        maxRecalledMemories: config.memory.maxRecalledMemories,
      }, subagentConfig);

      await memory.initialize();
      subagentConfig.db = memory['db'];

      const tools = new Map([
        ['view', viewTool],
        ['edit', editTool],
        ['bash', bashTool],
        ['search', searchTool],
        ['glob', globTool],
        ['recall', createRecallTool(memory)],
        ['remember', createRememberTool(memory)],
        ['index', createIndexWorkspaceTool(memory)],
      ]);

      const agent = new EnhancedAgent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
        autoCheckpoint: true,
        planMode: options.plan,
      });

      await agent.run(task, cwd, { planMode: options.plan });
      
      memory.close();
      
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'Task failed');
      process.exit(1);
    }
  });

program
  .command('plan <objective>')
  .description('Generate a plan without executing')
  .option('-p, --path <path>', 'Working directory', '.')
  .action(async (objective, options) => {
    const cwd = resolve(options.path);
    const planManager = new PlanManager(cwd);
    
    // Simple plan generation (would use LLM in production)
    const plan = await planManager.generate(objective, `Working directory: ${cwd}`);
    await planManager.writePlan(plan);
    
    console.log(`✅ Plan written to ${cwd}/PLAN.md`);
    console.log(`\nObjective: ${plan.objective}`);
    console.log(`Steps: ${plan.steps.length}`);
    console.log(`Estimated tokens: ${plan.estimatedTokens}`);
  });

program
  .command('execute <planFile>')
  .description('Execute a plan file')
  .action(async (planFile) => {
    // Would read PLAN.md and execute it
    console.log('Execute plan:', planFile);
  });

program
  .command('rollback [checkpointId]')
  .description('Rollback to a checkpoint')
  .option('-p, --path <path>', 'Working directory', '.')
  .action(async (checkpointId, options) => {
    const cwd = resolve(options.path);
    const config = loadConfig();
    
    const memory = new MemoryManager({
      dbPath: config.memory.dbPath,
    });

    await memory.initialize();
    memory.checkpointManager = new (await import('./checkpoint.js')).CheckpointManager(memory['db'], cwd);
    
    await memory.checkpointManager.rollback(checkpointId);
    console.log('✅ Rollback complete');
    
    memory.close();
  });

program
  .command('sessions')
  .description('List all saved sessions')
  .action(async () => {
    const config = loadConfig();
    
    const memory = new MemoryManager({
      dbPath: config.memory.dbPath,
    });

    await memory.initialize();

    const { Database } = await import('better-sqlite3');
    const db = new Database(memory['db'].name);
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];
    
    if (sessions.length === 0) {
      console.log('No saved sessions');
    } else {
      console.log('Recent sessions:\n');
      for (const s of sessions) {
        const date = new Date(s.updated_at).toLocaleString();
        console.log(`${s.id.slice(0, 8)}...  ${date}  ${s.cwd}`);
        if (s.summary) {
          console.log(`         ${s.summary.slice(0, 60)}`);
        }
      }
    }

    db.close();
    memory.close();
  });

program
  .command('checkpoints')
  .description('List checkpoints for current session')
  .option('-p, --path <path>', 'Working directory', '.')
  .action(async (options) => {
    const cwd = resolve(options.path);
    const config = loadConfig();
    
    const memory = new MemoryManager({
      dbPath: config.memory.dbPath,
    });

    await memory.initialize();
    memory.checkpointManager = new (await import('./checkpoint.js')).CheckpointManager(memory['db'], cwd);
    
    const checkpoints = memory.checkpointManager.list();
    
    if (checkpoints.length === 0) {
      console.log('No checkpoints');
    } else {
      console.log('Checkpoints:\n');
      for (const cp of checkpoints) {
        const date = new Date(cp.createdAt).toLocaleString();
        console.log(`${cp.id.slice(0, 8)}  ${date}  [${cp.type}]  ${cp.name}`);
      }
    }
    
    memory.close();
  });

program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    await showConfiguration();
  });

program
  .command('configure')
  .description('Interactive configuration wizard')
  .option('--reset', 'Reset configuration to defaults')
  .option('--test', 'Test API connection')
  .action(async (options) => {
    if (options.reset) {
      await resetConfiguration();
    } else if (options.test) {
      await testApiConnection();
    } else {
      await runConfigureWizard();
    }
  });

program
  .command('mcp')
  .description('Configure MCP (Model Context Protocol) servers')
  .action(async () => {
    await configureMcp();
  });

program
  .command('workspace [path]')
  .description('Set or show the default workspace directory')
  .action((path) => {
    const config = loadConfig();
    
    if (!path) {
      // Show current workspace
      console.log(`Current workspace: ${config.workspace.defaultPath}`);
      console.log(`Resolved: ${expandHomeDir(config.workspace.defaultPath)}`);
      return;
    }
    
    // Set new workspace
    const resolvedPath = expandHomeDir(path);
    if (!existsSync(resolvedPath)) {
      console.log(`Creating workspace directory: ${resolvedPath}`);
      mkdirSync(resolvedPath, { recursive: true });
    }
    
    config.workspace.defaultPath = path;
    saveConfig(config);
    console.log(`✅ Workspace set to: ${path}`);
    console.log(`Horus will use this path when you run 'horus chat' without a path argument`);
  });

// Helper functions for slash commands
async function handleCheckpointCommand(input: string, memory: MemoryManager, ui: TerminalUI) {
  const args = input.split(' ').slice(1);
  const name = args.join(' ') || `Checkpoint ${Date.now()}`;
  
  try {
    const cp = await memory.checkpointManager.create(name, memory.getCurrentSession()!.id);
    ui.writeLine(`\n💾 Checkpoint created: ${cp.name}`);
  } catch (error) {
    ui.error(`Failed to create checkpoint: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

async function handleRollbackCommand(input: string, memory: MemoryManager, ui: TerminalUI) {
  const args = input.split(' ').slice(1);
  const checkpointId = args[0];
  
  try {
    await memory.checkpointManager.rollback(checkpointId);
    ui.writeLine(`\n↩️  Rolled back${checkpointId ? ` to ${checkpointId}` : ''}`);
  } catch (error) {
    ui.error(`Rollback failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

async function handleTaskCommand(input: string, memory: MemoryManager, ui: TerminalUI) {
  if (!memory.subagentManager) {
    ui.error('Subagent manager not initialized');
    return;
  }

  const args = input.split(' ').slice(1);
  const description = args.join(' ');
  
  if (!description) {
    // List tasks
    const tasks = memory.subagentManager.list(memory.getCurrentSession()!.id);
    if (tasks.length === 0) {
      ui.writeLine('\nNo subagent tasks');
    } else {
      ui.writeLine(`\n${tasks.length} tasks:`);
      for (const t of tasks) {
        ui.writeLine(`  [${t.status}] ${t.description}`);
      }
    }
    return;
  }

  // Spawn new task
  const taskId = memory.subagentManager.spawn({
    parentSessionId: memory.getCurrentSession()!.id,
    description,
    prompt: description,
    cwd: memory.getCurrentSession()!.cwd,
  });

  ui.writeLine(`\n🚀 Task spawned: ${taskId.slice(0, 8)}...`);
}

import chalk from 'chalk';
import readline from 'readline';

function askYesNo(question: string, defaultValue: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const defaultStr = defaultValue ? 'Y/n' : 'y/N';
    rl.question(`${question} [${defaultStr}] `, (answer) => {
      rl.close();
      const lower = answer.toLowerCase().trim();
      if (lower === 'y' || lower === 'yes') resolve(true);
      else if (lower === 'n' || lower === 'no') resolve(false);
      else resolve(defaultValue);
    });
  });
}

program.parse();
