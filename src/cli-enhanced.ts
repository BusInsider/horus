#!/usr/bin/env node

import { Command } from 'commander';
import Database from 'better-sqlite3';
import { loadConfig, getConfigPath, saveConfig } from './config.js';
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
import { expandHomeDir } from './utils/paths.js';
import { SubagentConfig } from './subagent.js';
import { PlanManager } from './plan.js';
import { handleAgentCommand, printAgentHelp } from './agents/index.js';
import { initLogger } from './utils/logger.js';
import { ModeType, ModeController } from './mode-controller.js';
import { runConfigureWizard, showConfiguration, testApiConnection, resetConfiguration, configureMcp } from './configure.js';
import { runDoctor } from './doctor.js';
import chalk from 'chalk';

// Type for database session rows
interface SessionRow {
  id: string;
  updated_at: number;
  cwd: string;
  summary?: string;
}

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
  .command('modes')
  .description('List available modes and their descriptions')
  .action(() => {
    console.log(chalk.blue('\n🎯 Horus Modes\n'));
    console.log(chalk.gray('Horus supports four Kimi-native modes optimized for different use cases:\n'));
    
    const modes = [
      { name: 'instant', desc: 'Quick responses, lowest cost', temp: 0.6, tools: false, cost: '$0.60/M input' },
      { name: 'thinking', desc: 'Complex reasoning with chain-of-thought', temp: 1.0, tools: false, cost: '$0.60/M input' },
      { name: 'agent', desc: 'Multi-tool workflows (default)', temp: 1.0, tools: true, cost: '$0.60/M input' },
      { name: 'swarm', desc: 'Parallel sub-agent execution', temp: 1.0, tools: true, cost: 'Varies by parallelism' },
    ];
    
    for (const m of modes) {
      console.log(`${chalk.cyan(m.name.padEnd(10))} ${m.desc}`);
      console.log(`           Temp: ${m.temp} | Tools: ${m.tools ? 'enabled' : 'disabled'} | ${m.cost}`);
      console.log();
    }
    
    console.log(chalk.gray('Usage: horus chat --mode <mode>'));
    console.log(chalk.gray('Example: horus chat --mode thinking\n'));
  });

program
  .command('chat [path]')
  .description('Start an interactive chat session')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .option('-p, --plan', 'Enable plan mode')
  .option('-m, --mode <mode>', 'Mode: instant|thinking|agent|swarm (default: agent)')
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
        db: null as unknown as Database.Database, // Will be set after memory init
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

      // Validate and set mode
      let mode: ModeType = 'agent';
      if (options.mode) {
        const validModes: ModeType[] = ['instant', 'thinking', 'agent', 'swarm'];
        if (!validModes.includes(options.mode)) {
          console.error(`Error: Invalid mode "${options.mode}". Valid modes: ${validModes.join(', ')}`);
          process.exit(1);
        }
        mode = options.mode;
      }
      
      const modeController = new ModeController();
      modeController.setMode(mode);

      const agent = new EnhancedAgent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
        autoCheckpoint: true,
        planMode: options.plan,
        mode,
      });

      const modeConfig = modeController.getConfig();
      console.log(chalk.blue('\n🧠 Horus is ready. Type your task or "exit" to quit.\n'));
      console.log(chalk.gray(`Mode: ${modeConfig.name} | Temperature: ${modeConfig.temperature} | Tools: ${modeConfig.toolsEnabled ? 'enabled' : 'disabled'}\n`));
      if (options.plan) {
        console.log(chalk.yellow('📋 Plan mode enabled\n'));
      }

      // Use chat mode for interactive session
      try {
        await agent.chat(cwd, async () => {
          const input = await ui.prompt('>');
          
          // Handle special commands
          if (input.startsWith('/agent')) {
            const args = input.slice(6).trim().split(' ').filter(Boolean);
            if (args.length === 0) {
              printAgentHelp();
            } else {
              await handleAgentCommand(args);
            }
            return '';
          }

          if (input.startsWith('/checkpoint')) {
            await handleCheckpointCommand(input, memory, ui);
            return '';
          }

          if (input.startsWith('/rollback')) {
            await handleRollbackCommand(input, memory, ui);
            return '';
          }

          if (input.startsWith('/task')) {
            await handleTaskCommand(input, memory, ui);
            return '';
          }

          if (input.startsWith('/plan')) {
            // Return plan command for the agent to handle
            return input;
          }

          return input;
        });
      } catch (error) {
        ui.error(error instanceof Error ? error.message : 'Unknown error');
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
        db: null as unknown as Database.Database,
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

const sessionsCmd = program
  .command('sessions')
  .description('Session management commands');

sessionsCmd
  .command('list')
  .description('List all saved sessions')
  .action(async () => {
    const config = loadConfig();
    
    const memory = new MemoryManager({
      dbPath: config.memory.dbPath,
    });

    await memory.initialize();

    // Access the database directly through memory manager
    const db = (memory as { db: Database.Database }).db;
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[];
    
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

    memory.close();
  });

sessionsCmd
  .command('archive')
  .description('Archive old sessions to save space')
  .option('-d, --days <days>', 'Archive sessions older than N days', '30')
  .option('--dry-run', 'Show what would be archived without doing it')
  .action(async (options) => {
    const config = loadConfig();
    const { SessionArchiver } = await import('./session-archiver.js');
    
    const archiver = new SessionArchiver(config.memory.dbPath);
    await archiver.initialize();
    
    const days = parseInt(options.days, 10);
    const result = await archiver.archiveOldSessions(days, options.dryRun);
    
    if (options.dryRun) {
      console.log(`Would archive ${result.archived} sessions (${result.savedMB.toFixed(1)} MB)`);
    } else {
      console.log(`✅ Archived ${result.archived} sessions, saved ${result.savedMB.toFixed(1)} MB`);
    }
    
    archiver.close();
  });

sessionsCmd
  .command('archives')
  .description('List archived sessions')
  .action(async () => {
    const config = loadConfig();
    const { SessionArchiver } = await import('./session-archiver.js');
    
    const archiver = new SessionArchiver(config.memory.dbPath);
    await archiver.initialize();
    
    const archives = archiver.listArchives();
    
    if (archives.length === 0) {
      console.log('No archived sessions');
    } else {
      console.log('Archived sessions:\n');
      for (const a of archives) {
        const date = a.archivedAt.toLocaleString();
        const saved = ((a.originalSize - a.compressedSize) / (1024 * 1024)).toFixed(1);
        console.log(`${a.id.slice(0, 8)}...  ${date}  ${a.name || 'unnamed'} (${saved} MB saved)`);
      }
    }
    
    archiver.close();
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
  .option('--index', 'Re-index current workspace')
  .action(async (path, options) => {
    const config = loadConfig();
    
    if (options.index) {
      const { withSpinner } = await import('./ui/progress.js');
      await withSpinner('Indexing workspace', async () => {
        const memory = new MemoryManager({
          dbPath: config.memory.dbPath,
        });
        await memory.initialize();
        await memory.indexWorkspace(config.workspace.defaultPath);
        memory.close();
      });
      return;
    }
    
    if (!path) {
      // Show current workspace
      console.log(`Current workspace: ${chalk.cyan(config.workspace.defaultPath)}`);
      console.log(`Resolved: ${expandHomeDir(config.workspace.defaultPath)}`);
      console.log(`Auto-index: ${config.workspace.autoIndex ? 'enabled' : 'disabled'}`);
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

// Session templates
program
  .command('templates')
  .description('Manage session templates')
  .option('-l, --list', 'List available templates')
  .option('-c, --create <name>', 'Create new template from current session')
  .option('-d, --delete <name>', 'Delete a template')
  .option('--apply <name>', 'Apply template to current session')
  .action(async (options) => {
    const config = loadConfig();
    const { SessionTemplates } = await import('./session-templates.js');
    
    const templates = new SessionTemplates(config.memory.dbPath);
    await templates.initialize();
    
    if (options.list || (!options.create && !options.delete && !options.apply)) {
      const list = templates.list();
      if (list.length === 0) {
        console.log('No templates. Use --create <name> to create one.');
      } else {
        console.log('Available templates:');
        for (const t of list) {
          console.log(`  ${chalk.cyan(t.name)} - ${t.description}`);
        }
      }
    } else if (options.create) {
      const description = await askQuestion('Description: ');
      const systemPrompt = await askQuestion('System prompt (optional): ');
      const tags = await askQuestion('Tags (comma-separated): ');
      
      templates.create({
        name: options.create,
        description,
        systemPrompt: systemPrompt || undefined,
        tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
      });
      console.log(`✅ Template '${options.create}' created`);
    } else if (options.delete) {
      templates.delete(options.delete);
      console.log(`✅ Template '${options.delete}' deleted`);
    } else if (options.apply) {
      console.log(`Apply template: ${options.apply}`);
    }
    
    templates.close();
  });

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

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// GITHUB COMMANDS
// ============================================================================

const ghCmd = program
  .command('gh')
  .description('GitHub integration - PRs, issues, code review');

// PR subcommands
const prCmd = ghCmd
  .command('pr')
  .description('Pull request management');

prCmd
  .command('create')
  .description('Create a new pull request')
  .option('-t, --title <title>', 'PR title')
  .option('-b, --body <body>', 'PR body')
  .option('-d, --draft', 'Create as draft')
  .option('--push', 'Push branch before creating PR')
  .action(async (options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { PRWorkflow } = await import('./github/pr.js');
    
    const client = new GitHubClient();
    const workflow = new PRWorkflow(client);
    
    try {
      const pr = await workflow.create({
        title: options.title,
        body: options.body,
        draft: options.draft,
        push: options.push,
      });
      console.log(`✅ Created PR #${pr.number}: ${pr.html_url}`);
    } catch (error) {
      console.error('Failed to create PR:', (error as Error).message);
    }
  });

prCmd
  .command('list')
  .description('List open pull requests')
  .option('-s, --state <state>', 'Filter by state', 'open')
  .option('-a, --author <author>', 'Filter by author')
  .option('-l, --limit <limit>', 'Limit results', '20')
  .action(async (options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { PRWorkflow } = await import('./github/pr.js');
    
    const client = new GitHubClient();
    const workflow = new PRWorkflow(client);
    
    try {
      const prs = await workflow.list({
        state: options.state,
        author: options.author,
        limit: parseInt(options.limit, 10),
      });
      
      if (prs.length === 0) {
        console.log('No pull requests found');
        return;
      }
      
      console.log(`${prs.length} pull requests:\n`);
      for (const pr of prs) {
        const draft = pr.draft ? '[DRAFT] ' : '';
        console.log(`#${pr.number} ${draft}${pr.title}`);
        console.log(`    ${pr.user.login} → ${pr.base.ref} | ${pr.html_url}\n`);
      }
    } catch (error) {
      console.error('Failed to list PRs:', (error as Error).message);
    }
  });

prCmd
  .command('checkout <number>')
  .description('Checkout a pull request locally')
  .action(async (number) => {
    const { GitHubClient } = await import('./github/client.js');
    const { PRWorkflow } = await import('./github/pr.js');
    
    const client = new GitHubClient();
    const workflow = new PRWorkflow(client);
    
    try {
      await workflow.checkout(parseInt(number, 10));
    } catch (error) {
      console.error('Failed to checkout PR:', (error as Error).message);
    }
  });

prCmd
  .command('view <number>')
  .description('View pull request details')
  .action(async (number) => {
    const { GitHubClient } = await import('./github/client.js');
    const { PRWorkflow } = await import('./github/pr.js');
    
    const client = new GitHubClient();
    const workflow = new PRWorkflow(client);
    
    try {
      const overview = await workflow.getOverview(parseInt(number, 10));
      const pr = overview.pr;
      
      console.log(`\n#${pr.number}: ${pr.title}`);
      console.log(`State: ${pr.state}${pr.draft ? ' (draft)' : ''}`);
      console.log(`Author: ${pr.user.login}`);
      console.log(`Branch: ${pr.head.ref} → ${pr.base.ref}`);
      console.log(`URL: ${pr.html_url}`);
      console.log(`\nFiles changed: ${overview.stats.totalFiles}`);
      console.log(`+${overview.stats.totalAdditions} -${overview.stats.totalDeletions}`);
      
      if (overview.files.length > 0) {
        console.log('\nChanged files:');
        for (const f of overview.files.slice(0, 10)) {
          console.log(`  ${f.status.padEnd(8)} +${f.additions} -${f.deletions} ${f.filename}`);
        }
        if (overview.files.length > 10) {
          console.log(`  ... and ${overview.files.length - 10} more`);
        }
      }
    } catch (error) {
      console.error('Failed to view PR:', (error as Error).message);
    }
  });

prCmd
  .command('review <number>')
  .description('Review a pull request')
  .option('--comment <body>', 'Review comment')
  .option('--approve', 'Approve the PR')
  .option('--request-changes', 'Request changes')
  .option('--ai', 'Use AI-assisted review')
  .action(async (number, options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { CodeReview } = await import('./github/review.js');
    
    const client = new GitHubClient();
    
    try {
      if (options.ai) {
        const review = new CodeReview(client);
        const summary = await review.review({
          prNumber: parseInt(number, 10),
          autoComment: true,
        });
        console.log('\n' + summary.summary);
      } else if (options.approve) {
        const repo = client.getRepoFromCwd();
        if (!repo) throw new Error('Not in a GitHub repository');
        await client.createReview(repo.owner, repo.repo, parseInt(number, 10), {
          event: 'APPROVE',
          body: options.comment || 'LGTM 👍',
        });
        console.log('✅ Approved PR');
      } else if (options.requestChanges) {
        const repo = client.getRepoFromCwd();
        if (!repo) throw new Error('Not in a GitHub repository');
        await client.createReview(repo.owner, repo.repo, parseInt(number, 10), {
          event: 'REQUEST_CHANGES',
          body: options.comment || 'Changes requested',
        });
        console.log('✅ Requested changes');
      } else {
        console.log('Use --approve, --request-changes, or --ai');
      }
    } catch (error) {
      console.error('Failed to review PR:', (error as Error).message);
    }
  });

// Issue subcommands
const issueCmd = ghCmd
  .command('issue')
  .description('Issue management');

issueCmd
  .command('list')
  .description('List issues')
  .option('-s, --state <state>', 'Filter by state', 'open')
  .option('-l, --label <labels>', 'Filter by labels (comma-separated)')
  .option('-a, --assignee <assignee>', 'Filter by assignee')
  .action(async (options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { IssuesWorkflow } = await import('./github/issues.js');
    
    const client = new GitHubClient();
    const workflow = new IssuesWorkflow(client);
    
    try {
      const issues = await workflow.list({
        state: options.state,
        labels: options.label?.split(','),
        assignee: options.assignee,
      });
      
      if (issues.length === 0) {
        console.log('No issues found');
        return;
      }
      
      console.log(`${issues.length} issues:\n`);
      for (const issue of issues) {
        const labels = issue.labels.map(l => `[${l.name}]`).join(' ');
        console.log(`#${issue.number} ${issue.title} ${labels}`);
        console.log(`    ${issue.user.login} | ${issue.html_url}\n`);
      }
    } catch (error) {
      console.error('Failed to list issues:', (error as Error).message);
    }
  });

issueCmd
  .command('view <number>')
  .description('View issue details')
  .action(async (number) => {
    const { GitHubClient } = await import('./github/client.js');
    const { IssuesWorkflow } = await import('./github/issues.js');
    
    const client = new GitHubClient();
    const workflow = new IssuesWorkflow(client);
    
    try {
      const issue = await workflow.get(parseInt(number, 10));
      
      console.log(`\n#${issue.number}: ${issue.title}`);
      console.log(`State: ${issue.state}`);
      console.log(`Author: ${issue.user.login}`);
      console.log(`Labels: ${issue.labels.map(l => l.name).join(', ') || 'None'}`);
      console.log(`URL: ${issue.html_url}`);
      console.log(`\n${issue.body || 'No description'}\n`);
    } catch (error) {
      console.error('Failed to view issue:', (error as Error).message);
    }
  });

issueCmd
  .command('create')
  .description('Create a new issue')
  .option('-t, --title <title>', 'Issue title', 'New issue')
  .option('-b, --body <body>', 'Issue body')
  .option('-l, --label <labels>', 'Labels (comma-separated)')
  .option('--type <type>', 'Issue type (bug/feature/task)', 'task')
  .action(async (options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { IssuesWorkflow } = await import('./github/issues.js');
    
    const client = new GitHubClient();
    const workflow = new IssuesWorkflow(client);
    
    try {
      const issue = await workflow.create({
        type: options.type,
        title: options.title,
        description: options.body || '',
        labels: options.label?.split(',') || [],
      });
      console.log(`✅ Created issue #${issue.number}: ${issue.html_url}`);
    } catch (error) {
      console.error('Failed to create issue:', (error as Error).message);
    }
  });

issueCmd
  .command('close <number>')
  .description('Close an issue')
  .option('-c, --comment <comment>', 'Closing comment')
  .action(async (number, options) => {
    const { GitHubClient } = await import('./github/client.js');
    const { IssuesWorkflow } = await import('./github/issues.js');
    
    const client = new GitHubClient();
    const workflow = new IssuesWorkflow(client);
    
    try {
      await workflow.close(parseInt(number, 10), options.comment);
    } catch (error) {
      console.error('Failed to close issue:', (error as Error).message);
    }
  });

// Auth subcommand
ghCmd
  .command('auth')
  .description('Check GitHub authentication')
  .action(async () => {
    const { GitHubClient } = await import('./github/client.js');
    
    try {
      const client = new GitHubClient();
      const auth = await client.checkAuth();
      console.log(`✅ Authenticated as ${auth.user}`);
      console.log(`Scopes: ${auth.scopes.join(', ') || 'none'}`);
    } catch (error) {
      console.error('❌ Not authenticated:', (error as Error).message);
      console.log('\nTo authenticate, set GITHUB_TOKEN environment variable:');
      console.log('  export GITHUB_TOKEN=your_token_here');
      console.log('\nOr run: gh auth login');
    }
  });

program.parse();
