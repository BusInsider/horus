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
  catTool,
  lsTool,
  mkdirTool,
  rmTool,
  grepTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  fetchTool,
  jsonParseTool,
  jsonFormatTool,
  mathTool,
  createRecallTool,
  createRememberTool,
  createIndexWorkspaceTool,
  createSkillListTool,
  createSkillCreateTool,
  createSkillViewTool,
  createSkillDeleteTool,
  createSkillEvolveTool,
  createSkillStatsTool,
} from './tools/index.js';
import { getSkillRegistry } from './skills/registry.js';
import { CompiledSkill } from './skills/types.js';
import { resolve } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { expandHomeDir } from './utils/paths.js';
import { SubagentConfig } from './subagent.js';
import { PlanManager } from './plan.js';
import { handleAgentCommand, printAgentHelp } from './agents/index.js';
import { initLogger } from './utils/logger.js';
import { ModeType, ModeController } from './mode-controller.js';
import { TraceViewer } from './utils/tracer.js';
import { analyzeSession, aggregateStats, compareSessions, formatDuration, formatCost } from './utils/trace-analysis.js';
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

// Special error to signal restart
class RestartError extends Error {
  constructor() {
    super('Restart requested');
    this.name = 'RestartError';
  }
}

const program = new Command();

program
  .name('horus')
  .description('Hermes-equivalent autonomous agent for Kimi K2.5 and K2.6')
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
  .option('--fix', 'Attempt to fix native module issues automatically')
  .action(async (options) => {
    await runDoctor({ fix: options.fix });
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
  .option('-m, --mode <mode>', 'Mode: fast|balanced|thorough|swarm (default: balanced). Legacy: instant|thinking|agent')
  .option('--turbo', 'Use turbo model for maximum speed (overrides mode model)')
  .option('--show-thinking', 'Display reasoning_content (thinking mode)')
  .option('-n, --name <name>', 'Name this session for later reference')
  .option('--tag <tags>', 'Comma-separated tags for this session')
  .option('-q, --quiet', 'Minimal output (tools shown as [name] only)')
  .option('-v, --verbose', 'Detailed output (full tool arguments and results)')
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

    // Determine verbosity from command options or global options
    let verbosity: 'quiet' | 'normal' | 'verbose' = config.agent?.verbosity || 'normal';
    if (options.quiet || globalOptions.quiet) verbosity = 'quiet';
    if (options.verbose || globalOptions.verbose) verbosity = 'verbose';
    

    
    const ui = new TerminalUI(verbosity);
    
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
      subagentConfig.db = (memory as unknown as { db: Database.Database }).db;

      const tools = new Map([
        // File operations
        ['view', viewTool],
        ['edit', editTool],
        ['cat', catTool],
        ['ls', lsTool],
        ['mkdir', mkdirTool],
        ['rm', rmTool],
        
        // Search and discovery
        ['search', searchTool],
        ['glob', globTool],
        ['grep', grepTool],
        
        // Command execution
        ['bash', bashTool],
        
        // Git operations
        ['git_status', gitStatusTool],
        ['git_diff', gitDiffTool],
        ['git_log', gitLogTool],
        
        // Data processing
        ['fetch', fetchTool],
        ['json_parse', jsonParseTool],
        ['json_format', jsonFormatTool],
        ['math', mathTool],
        
        // Memory
        ['recall', createRecallTool(memory)],
        ['remember', createRememberTool(memory)],
        ['index', createIndexWorkspaceTool(memory)],
        
        // Skill management
        ['skill_list', createSkillListTool()],
        ['skill_create', createSkillCreateTool(kimi)],
        ['skill_view', createSkillViewTool()],
        ['skill_delete', createSkillDeleteTool()],
        ['skill_evolve', createSkillEvolveTool(kimi)],
        ['skill_stats', createSkillStatsTool()],
      ]);
      
      // Load skills from registry
      const skillRegistry = getSkillRegistry();
      await skillRegistry.initialize();
      const skills = skillRegistry.getAllTools();
      for (const skill of skills) {
        const compiledSkill = skill as CompiledSkill;
        if (compiledSkill.skillId) {
          tools.set(compiledSkill.skillId, skill);
        }
      }

      // Validate and set mode (with backwards compatibility)
      let mode: ModeType = 'balanced';
      if (options.mode) {
        try {
          mode = ModeController.validateMode(options.mode);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : 'Invalid mode'}`);
          console.error(`Available modes: fast, balanced, thorough, swarm`);
          console.error(`(Legacy names also work: instant, thinking, agent)`);
          process.exit(1);
        }
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
        showThinking: options.showThinking,
        turbo: options.turbo,
      });

      const modeConfig = modeController.getConfig();
      const modelLabel = options.turbo ? 'TURBO' : (modeConfig.model || config.provider.model);
      console.log(chalk.blue('\n🧠 Horus is ready. Type your task or "exit" to quit.\n'));
      console.log(chalk.gray(`Mode: ${modeConfig.name} | Model: ${modelLabel} | Temp: ${modeConfig.temperature} | Latency: ${modeConfig.latency}\n`));
      console.log(chalk.gray(`Tip: Use /mode <fast|balanced|thorough|swarm> to switch modes\n`));
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

          if (input.startsWith('/mode')) {
            const args = input.slice(5).trim().split(' ').filter(Boolean);
            if (args.length === 0) {
              const currentMode = modeController.getConfig();
              ui.writeLine(`\nCurrent mode: ${currentMode.name}`);
              ui.writeLine(`Description: ${currentMode.description}`);
              ui.writeLine(`\nAvailable modes:`);
              for (const { type, config } of ModeController.getAvailableModes()) {
                ui.writeLine(`  ${type.padEnd(10)} - ${config.useCase}`);
              }
              ui.writeLine(`\nUsage: /mode <fast|balanced|thorough|swarm>`);
            } else {
              try {
                const newMode = ModeController.validateMode(args[0]);
                modeController.setMode(newMode);
                const config = modeController.getConfig();
                ui.writeLine(`\n✅ Switched to ${config.name} mode`);
                ui.writeLine(`   ${config.description}`);
              } catch (error) {
                ui.writeLine(`\n❌ Error: ${error instanceof Error ? error.message : 'Invalid mode'}`);
              }
            }
            return '';
          }

          if (input === '/restart' || input === '/reload') {
            ui.writeLine(chalk.yellow('\n🔄 Restarting Horus to load new code...'));
            throw new RestartError();
          }

          if (input === '/memory' || input.startsWith('/memory ')) {
            const args = input.slice(7).trim();
            if (args === 'clear' || args === 'reset') {
              // Note: Actual clearing would require implementing clearMemory in MemoryManager
              ui.writeLine(chalk.yellow('\n⚠️  Memory clearing not yet implemented'));
            } else {
              // Show recent memories
              const facts = memory.getFacts(undefined, 10);
              ui.writeLine(chalk.blue('\n📚 Recent Memories:'));
              if (facts.length === 0) {
                ui.writeLine(chalk.gray('  No memories stored yet'));
              } else {
                for (const fact of facts) {
                  const date = new Date(fact.createdAt).toLocaleDateString();
                  ui.writeLine(chalk.gray(`  [${fact.category}] ${date}: ${fact.fact.substring(0, 60)}${fact.fact.length > 60 ? '...' : ''}`));
                }
              }
              ui.writeLine(chalk.gray(`\nTotal memories: ${facts.length}`));
            }
            return '';
          }

          return input;
        });
      } catch (error) {
        if (error instanceof RestartError) {
          // Restart requested - close resources and exec new process
          ui.close();
          memory.close();
          
          console.log(chalk.blue('\n♻️  Restarting Horus...\n'));
          
          // Get the path to the current executable
          const { execPath } = process;
          const args = process.argv.slice(2).filter(arg => arg !== '--resume');
          
          // Spawn new process and exit this one
          const { spawn } = await import('child_process');
          spawn(execPath, args, {
            stdio: 'inherit',
            detached: true,
          }).unref();
          
          process.exit(0);
        }
        ui.error(error instanceof Error ? error.message : 'Unknown error');
      }

      ui.close();
      memory.close();
      
    } catch (error) {
      if (error instanceof RestartError) {
        console.log(chalk.blue('\n♻️  Restarting Horus...\n'));
        const { execPath } = process;
        const args = process.argv.slice(2).filter(arg => arg !== '--resume');
        const { spawn } = await import('child_process');
        spawn(execPath, args, {
          stdio: 'inherit',
          detached: true,
        }).unref();
        process.exit(0);
      }
      ui.error(error instanceof Error ? error.message : 'Failed to start Horus');
      process.exit(1);
    }
  });

program
  .command('run <task>')
  .description('Execute a single task and exit')
  .option('-p, --path <path>', 'Working directory')
  .option('--plan', 'Use plan mode')
  .option('--fresh', 'Start fresh, ignore crashed sessions')
  .option('-m, --mode <mode>', 'Mode: fast|balanced|thorough|swarm (default: balanced)')
  .option('--turbo', 'Use turbo model for maximum speed (overrides mode model)')
  .option('-q, --quiet', 'Minimal output')
  .option('-v, --verbose', 'Detailed output')
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

    // Determine verbosity from command options or global options
    let verbosity: 'quiet' | 'normal' | 'verbose' = config.agent.verbosity || 'normal';
    if (options.quiet || globalOptions.quiet) verbosity = 'quiet';
    if (options.verbose || globalOptions.verbose) verbosity = 'verbose';
    
    const ui = new TerminalUI(verbosity);
    
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

      // Validate mode
      let mode: ModeType = 'balanced';
      if (options.mode) {
        try {
          mode = ModeController.validateMode(options.mode);
        } catch (error) {
          console.error(`Error: ${error instanceof Error ? error.message : 'Invalid mode'}`);
          console.error(`Available modes: fast, balanced, thorough, swarm`);
          process.exit(1);
        }
      }

      const agent = new EnhancedAgent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
        autoCheckpoint: true,
        planMode: options.plan,
        mode,
        turbo: options.turbo,
      });

      const modeControllerRun = new ModeController();
      modeControllerRun.setMode(mode);
      const modeConfigRun = modeControllerRun.getConfig();
      const modelLabel = options.turbo ? 'TURBO' : (modeConfigRun.model || config.provider.model);
      if (!options.quiet) {
        console.log(chalk.gray(`Mode: ${modeConfigRun.name} | Model: ${modelLabel} | Temp: ${modeConfigRun.temperature} | Latency: ${modeConfigRun.latency}`));
      }

      await agent.run(task, cwd, { planMode: options.plan, fresh: options.fresh });
      
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
    const db = (memory as unknown as { db: Database.Database }).db;
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
  .command('eval')
  .description('Run the Horus evaluation suite')
  .option('--quick', 'Run quick eval set (9 tasks, ~5 min)')
  .option('--full', 'Run full eval suite (20+ tasks, ~15 min)')
  .option('--task <name>', 'Run a specific eval task')
  .option('--list', 'List available eval tasks')
  .option('--report [path]', 'Run full suite and generate markdown report')
  .action(async (options) => {
    const projectRoot = resolve(__dirname, '..');
    const runnerPath = resolve(projectRoot, 'scripts', 'eval-runner.js');

    if (!existsSync(runnerPath)) {
      console.error(chalk.red('Eval runner not found. Expected:'), runnerPath);
      process.exit(1);
    }

    // Report mode: run full suite, save to temp, generate markdown
    if (options.report !== undefined) {
      const tmpResults = resolve(projectRoot, 'evals', 'results-report.json');
      const suiteArg = options.quick ? '--quick' : '--full';
      console.log(chalk.blue('\n🧪 Running eval suite for report...\n'));
      try {
        execSync(`node "${runnerPath}" ${suiteArg} --output "${tmpResults}"`, {
          cwd: projectRoot,
          stdio: 'inherit',
        });
      } catch {
        // Suite may have failures; we still want the report
      }

      if (!existsSync(tmpResults)) {
        console.error(chalk.red('No results generated'));
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(tmpResults, 'utf-8'));
      const report = generateEvalReport(data);

      const reportPath = typeof options.report === 'string' ? options.report : resolve(projectRoot, 'evals', 'report.md');
      writeFileSync(reportPath, report);
      console.log(chalk.green(`\n📊 Report saved to: ${reportPath}`));

      // Also print summary
      const passed = data.results.filter((r: any) => r.passed).length;
      const total = data.results.length;
      console.log(`\nSummary: ${passed}/${total} passed (${(passed/total*100).toFixed(0)}%)`);
      return;
    }

    let args = '';
    if (options.list) {
      args = '--list';
    } else if (options.quick) {
      args = '--quick';
    } else if (options.full) {
      args = '--full';
    } else if (options.task) {
      args = `--task ${options.task}`;
    } else {
      console.log(chalk.blue('\n🧪 Horus Eval Suite\n'));
      console.log('Run evaluations to measure harness quality:\n');
      console.log('  ' + chalk.cyan('horus eval --quick') + '     Fast feedback (9 tasks)');
      console.log('  ' + chalk.cyan('horus eval --full') + '      Full suite (20+ tasks)');
      console.log('  ' + chalk.cyan('horus eval --task NAME') + ' Single task');
      console.log('  ' + chalk.cyan('horus eval --list') + '      Show all tasks');
      console.log('  ' + chalk.cyan('horus eval --report') + '    Generate markdown report\n');
      console.log(chalk.gray('Tip: Run "npm run build" before evals to test the latest binary.\n'));
      return;
    }

    try {
      execSync(`node "${runnerPath}" ${args}`, {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch (e) {
      // Exit code is forwarded; don't print extra error
      const status = (e as { status?: number })?.status;
      process.exit(status || 1);
    }
  });

program
  .command('trace')
  .description('View and analyze session traces')
  .option('--list', 'List all session traces')
  .option('--view <id>', 'View a specific trace')
  .option('--latest', 'View the most recent trace')
  .option('--analyze <id>', 'Analyze a trace (summary + stats)')
  .option('--stats', 'Show aggregate statistics across all traces')
  .option('--compare <ids>', 'Compare two traces (comma-separated IDs)')
  .action(async (options) => {
    const viewer = new TraceViewer();

    if (options.list) {
      const traces = viewer.listTraces();
      if (traces.length === 0) {
        console.log(chalk.gray('No traces found in ~/.horus/traces/'));
        return;
      }
      console.log(chalk.blue('\n📋 Session Traces\n'));
      console.log(`${chalk.bold('ID'.padEnd(28))} ${chalk.bold('Date'.padEnd(22))} ${chalk.bold('Events')}`);
      console.log('─'.repeat(70));
      for (const t of traces) {
        const dateStr = t.date.toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        console.log(`${t.id.padEnd(28)} ${dateStr.padEnd(22)} ${String(t.events).padStart(4)}`);
      }
      console.log();
      return;
    }

    if (options.view) {
      const output = viewer.viewTrace(options.view);
      console.log(output);
      return;
    }

    if (options.latest) {
      const traces = viewer.listTraces();
      if (traces.length === 0) {
        console.log(chalk.gray('No traces found'));
        return;
      }
      const output = viewer.viewTrace(traces[0].id);
      console.log(output);
      return;
    }

    if (options.analyze) {
      const summary = analyzeSession(options.analyze);
      if (!summary) {
        console.log(chalk.red(`Trace not found: ${options.analyze}`));
        return;
      }
      console.log(chalk.blue('\n📊 Session Analysis\n'));
      console.log(`Session:    ${chalk.cyan(summary.sessionId)}`);
      console.log(`Started:    ${summary.startTime.toLocaleString()}`);
      console.log(`Duration:   ${formatDuration(summary.durationMs)}`);
      console.log(`CWD:        ${summary.cwd}`);
      console.log(`Mode:       ${summary.mode}`);
      console.log(`Model:      ${summary.model}`);
      console.log(`Iterations: ${summary.iterations}`);
      console.log();
      console.log(chalk.bold('Metrics:'));
      console.log(`  API calls:        ${summary.apiCalls}`);
      console.log(`  Tool calls:       ${summary.toolCalls}`);
      console.log(`  Errors:           ${summary.errors}`);
      console.log(`  Prompt tokens:    ${summary.promptTokens.toLocaleString()}`);
      console.log(`  Completion tokens: ${summary.completionTokens.toLocaleString()}`);
      console.log(`  Total tokens:     ${summary.totalTokens.toLocaleString()}`);
      console.log(`  Est. cost:        ${formatCost(summary.estimatedCost)}`);
      if (summary.errors > 0) {
        console.log();
        console.log(chalk.bold('Errors:'));
        for (const err of summary.errorEvents) {
          console.log(`  ${chalk.red('❌')} ${err.error}${err.context ? chalk.gray(` [${err.context}]`) : ''}`);
        }
      }
      if (Object.keys(summary.toolDistribution).length > 0) {
        console.log();
        console.log(chalk.bold('Tool usage:'));
        const sorted = Object.entries(summary.toolDistribution).sort((a, b) => b[1] - a[1]);
        for (const [name, count] of sorted) {
          console.log(`  ${name.padEnd(20)} ${String(count).padStart(3)}x`);
        }
      }
      if (summary.modeSwitches.length > 0) {
        console.log();
        console.log(chalk.bold('Mode switches:'));
        for (const ms of summary.modeSwitches) {
          console.log(`  ${ms.from} → ${ms.to} ${chalk.gray(ms.timestamp)}`);
        }
      }
      console.log();
      return;
    }

    if (options.stats) {
      const stats = aggregateStats();
      if (!stats) {
        console.log(chalk.gray('No traces found'));
        return;
      }
      console.log(chalk.blue('\n📈 Aggregate Statistics\n'));
      console.log(`Sessions:      ${stats.totalSessions}`);
      console.log(`Total time:    ${formatDuration(stats.totalDurationMs)}`);
      console.log(`Total APIs:    ${stats.totalApiCalls}`);
      console.log(`Total tools:   ${stats.totalToolCalls}`);
      console.log(`Total errors:  ${stats.totalErrors}`);
      console.log(`Total tokens:  ${stats.totalTokens.toLocaleString()}`);
      console.log(`Est. cost:     ${formatCost(stats.totalEstimatedCost)}`);
      console.log();
      console.log(`Avg duration:  ${formatDuration(stats.avgDurationMs)}`);
      console.log(`Avg API calls: ${stats.avgApiCalls}`);
      console.log(`Avg tool calls: ${stats.avgToolCalls}`);
      console.log(`Avg tokens:    ${stats.avgTokens.toLocaleString()}`);
      console.log(`Error rate:    ${(stats.errorRate * 100).toFixed(1)}%`);
      if (stats.topTools.length > 0) {
        console.log();
        console.log(chalk.bold('Top tools:'));
        for (const t of stats.topTools) {
          console.log(`  ${t.name.padEnd(20)} ${String(t.count).padStart(4)}x`);
        }
      }
      console.log();
      return;
    }

    if (options.compare) {
      const ids = options.compare.split(',').map((s: string) => s.trim());
      if (ids.length !== 2) {
        console.log(chalk.red('Usage: --compare id1,id2'));
        return;
      }
      const comparison = compareSessions(ids[0], ids[1]);
      if (!comparison) {
        console.log(chalk.red('One or both traces not found'));
        return;
      }
      const { left, right, deltas } = comparison;
      console.log(chalk.blue('\n⚖️  Trace Comparison\n'));
      console.log(`               ${left.sessionId.slice(0, 20).padEnd(20)} ${right.sessionId.slice(0, 20).padEnd(20)} ${chalk.bold('Delta')}`);
      console.log('─'.repeat(80));
      const row = (label: string, l: string, r: string, d: string, color?: boolean) => {
        const deltaStr = color ? (d.startsWith('+') ? chalk.green(d) : d.startsWith('-') ? chalk.red(d) : d) : d;
        console.log(`${label.padEnd(12)} ${l.padEnd(20)} ${r.padEnd(20)} ${deltaStr}`);
      };
      row('Duration', formatDuration(left.durationMs), formatDuration(right.durationMs),
        `${deltas.durationMs >= 0 ? '+' : ''}${formatDuration(Math.abs(deltas.durationMs))}`, true);
      row('API calls', String(left.apiCalls), String(right.apiCalls),
        `${deltas.apiCalls >= 0 ? '+' : ''}${deltas.apiCalls}`, true);
      row('Tool calls', String(left.toolCalls), String(right.toolCalls),
        `${deltas.toolCalls >= 0 ? '+' : ''}${deltas.toolCalls}`, true);
      row('Errors', String(left.errors), String(right.errors),
        `${deltas.errors >= 0 ? '+' : ''}${deltas.errors}`, true);
      row('Tokens', left.totalTokens.toLocaleString(), right.totalTokens.toLocaleString(),
        `${deltas.totalTokens >= 0 ? '+' : ''}${deltas.totalTokens.toLocaleString()}`, true);
      row('Est. cost', formatCost(left.estimatedCost), formatCost(right.estimatedCost),
        `${deltas.estimatedCost >= 0 ? '+' : ''}${formatCost(Math.abs(deltas.estimatedCost))}`, true);
      console.log();
      return;
    }

    // Default: show help
    console.log(chalk.blue('\n📋 Trace Commands\n'));
    console.log('  ' + chalk.cyan('horus trace --list') + '              List all traces');
    console.log('  ' + chalk.cyan('horus trace --view <id>') + '         View specific trace');
    console.log('  ' + chalk.cyan('horus trace --latest') + '            View most recent trace');
    console.log('  ' + chalk.cyan('horus trace --analyze <id>') + '      Analyze trace summary');
    console.log('  ' + chalk.cyan('horus trace --stats') + '             Aggregate statistics');
    console.log('  ' + chalk.cyan('horus trace --compare id1,id2') + ' Compare two traces');
    console.log();
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

// Phase 2: Hibernation commands
const hibernationCmd = program
  .command('hibernation')
  .alias('hib')
  .description('Agent state management - save, resume, clone');

hibernationCmd
  .command('list')
  .description('List all saved agent states')
  .action(async () => {
    const { getHibernationManager } = await import('./hibernation.js');
    
    const manager = getHibernationManager();
    await manager.initialize();
    
    const checkpoints = await manager.listCheckpoints();
    
    if (checkpoints.length === 0) {
      console.log('No saved agent states');
    } else {
      console.log('Saved agent states:\n');
      for (const cp of checkpoints) {
        const date = new Date(cp.createdAt).toLocaleString();
        const size = (cp.size / 1024).toFixed(1);
        console.log(`${cp.id}  ${date}  ${size}KB  ${cp.description}`);
        if (cp.tags.length > 0) {
          console.log(`         Tags: ${cp.tags.join(', ')}`);
        }
      }
    }
  });

hibernationCmd
  .command('delete <id>')
  .description('Delete a saved agent state')
  .action(async (id) => {
    const { getHibernationManager } = await import('./hibernation.js');
    
    const manager = getHibernationManager();
    await manager.initialize();
    
    const deleted = await manager.deleteCheckpoint(id);
    if (deleted) {
      console.log(`✅ Deleted state ${id}`);
    } else {
      console.log(`❌ State ${id} not found`);
    }
  });

// Phase 2: Swarm commands
const swarmCmd = program
  .command('swarm')
  .description('Multi-agent orchestration');

swarmCmd
  .command('execute <objective>')
  .description('Execute a complex objective using multiple agents')
  .option('-p, --parallel <n>', 'Max parallel agents', '5')
  .option('-s, --strategy <type>', 'Strategy: hierarchical|flat|mesh', 'hierarchical')
  .action(async (objective, _options) => {
    const config = loadConfig();
    
    if (!config.provider.apiKey) {
      console.error('Error: KIMI_API_KEY not set');
      process.exit(1);
    }
    
    const { KimiClient } = await import('./kimi.js');
    const { getHibernationManager } = await import('./hibernation.js');
    const { getSwarmOrchestrator } = await import('./swarm/orchestrator.js');
    
    const kimi = new KimiClient({
      apiKey: config.provider.apiKey,
      baseUrl: config.provider.baseUrl,
      model: config.provider.model,
    });
    
    const hibernation = getHibernationManager();
    await hibernation.initialize();
    
    const orchestrator = getSwarmOrchestrator(kimi, hibernation);
    
    console.log(`🐝 Swarm executing: ${objective}\n`);
    
    try {
      const result = await orchestrator.execute(objective);
      
      console.log('\n✅ Swarm execution complete\n');
      console.log(`Success: ${result.success}`);
      console.log(`Subagents: ${result.metrics.totalSubagents}`);
      console.log(`Messages: ${result.metrics.totalMessages}`);
      console.log(`Parallel groups: ${result.metrics.parallelExecutions}`);
      console.log(`Execution time: ${(result.metrics.totalExecutionTime / 1000).toFixed(1)}s\n`);
      
      console.log('Result:');
      console.log(result.aggregatedOutput);
    } catch (error) {
      console.error('❌ Swarm execution failed:', (error as Error).message);
    }
  });

swarmCmd
  .command('status')
  .description('Show current swarm state')
  .action(async () => {
    console.log('Swarm status: Not in an active swarm session');
    console.log('Use "horus swarm execute <objective>" to start one');
  });

function generateEvalReport(data: any): string {
  const results = data.results || [];
  const passed = results.filter((r: any) => r.passed);
  const failed = results.filter((r: any) => !r.passed);
  const avgTime = results.reduce((sum: number, r: any) => sum + (r.elapsed || 0), 0) / results.length;
  const avgScore = results.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / results.length;

  let report = `# Horus Eval Report\n\n`;
  report += `**Generated:** ${new Date(data.timestamp).toLocaleString()}\\n`;
  report += `**Commit:** ${data.commit}\\n`;
  report += `**Model:** kimi-k2-6\\n\n`;

  report += `## Summary\\n\n`;
  report += `| Metric | Value |\\n`;
  report += `|--------|-------|\\n`;
  report += `| Total Tasks | ${results.length} |\\n`;
  report += `| Passed | ${passed.length} |\\n`;
  report += `| Failed | ${failed.length} |\\n`;
  report += `| Pass Rate | ${(passed.length / results.length * 100).toFixed(1)}% |\\n`;
  report += `| Avg Score | ${(avgScore * 100).toFixed(1)}% |\\n`;
  report += `| Avg Time | ${(avgTime / 1000).toFixed(1)}s |\\n\n`;

  if (failed.length > 0) {
    report += `## Failures\\n\n`;
    report += `| Task | Score | Time | Notes |\\n`;
    report += `|------|-------|------|-------|\\n`;
    for (const r of failed) {
      const notes = r.details ? Object.entries(r.details).filter(([_, v]) => !v).map(([k]) => k).join(', ') : 'n/a';
      report += `| ${r.name} | ${(r.score * 100).toFixed(0)}% | ${(r.elapsed / 1000).toFixed(1)}s | ${notes} |\\n`;
    }
    report += `\\n`;
  }

  report += `## Task Breakdown\\n\n`;
  report += `| Task | Score | Time | Status |\\n`;
  report += `|------|-------|------|--------|\\n`;
  for (const r of results) {
    const status = r.passed ? '✅' : '❌';
    report += `| ${r.name} | ${(r.score * 100).toFixed(0)}% | ${(r.elapsed / 1000).toFixed(1)}s | ${status} |\\n`;
  }
  report += `\\n`;

  report += `## Recommendations\\n\n`;
  if (failed.length === 0) {
    report += `- All tasks passing. Consider adding harder evals to find the next breaking point.\\n`;
  } else {
    report += `- **Priority**: Fix ${failed[0].name} (lowest score)\\n`;
    if (failed.length > 1) {
      report += `- **Secondary**: Address ${failed.slice(1).map((r: any) => r.name).join(', ')}\\n`;
    }
    report += `- Review traces with 'horus trace analyze <session-id>'
`;

  }
  report += `- Run regression suite before each commit\\n`;

  return report;
}

program.parse();
