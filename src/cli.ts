#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, getConfigPath } from './config.js';
import { KimiClient } from './kimi.js';
import { MemoryManager } from './memory/manager.js';
import { Agent } from './agent.js';
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

const program = new Command();

program
  .name('horus')
  .description('Kimi-native autonomous coding agent with memory')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Horus configuration')
  .action(async () => {
    const configPath = getConfigPath();
    
    if (existsSync(configPath)) {
      console.log(`Config already exists at ${configPath}`);
    } else {
      loadConfig(); // This creates the default config
    }

    // Ensure directories exist
    const horusDir = resolve(homedir(), '.horus');
    if (!existsSync(horusDir)) {
      mkdirSync(horusDir, { recursive: true });
    }

    console.log('\nHorus initialized!');
    console.log(`Config: ${configPath}`);
    console.log(`Memory: ${resolve(homedir(), '.horus', 'memory.db')}`);
    
    const config = loadConfig();
    if (!config.provider.apiKey) {
      console.log('\n⚠️  Please set your KIMI_API_KEY in the config file or environment');
    }
  });

program
  .command('chat [path]')
  .description('Start an interactive chat session')
  .option('-r, --resume <sessionId>', 'Resume a previous session')
  .action(async (path, options) => {
    const cwd = resolve(path || '.');
    
    if (!existsSync(cwd)) {
      console.error(`Path not found: ${cwd}`);
      process.exit(1);
    }

    const config = loadConfig();
    
    if (!config.provider.apiKey) {
      console.error('Error: KIMI_API_KEY not set. Run `horus init` and edit the config.');
      process.exit(1);
    }

    const ui = new TerminalUI();
    
    try {
      // Initialize components
      const kimi = new KimiClient({
        apiKey: config.provider.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
      });

      const memory = new MemoryManager({
        dbPath: config.memory.dbPath,
        embeddingModel: config.memory.embeddingModel,
        maxWorkingTokens: config.memory.maxWorkingTokens,
        recallThreshold: config.memory.recallThreshold,
        maxRecalledMemories: config.memory.maxRecalledMemories,
      });

      await memory.initialize();

      // Create tools with memory injection
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

      const agent = new Agent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
      });

      console.log(chalk.blue('\n🧠 Horus is ready. Type your task or "exit" to quit.\n'));

      // Interactive loop
      while (true) {
        const input = await ui.prompt('>');
        
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          break;
        }

        if (!input.trim()) {
          continue;
        }

        try {
          await agent.run(input, cwd);
        } catch (error) {
          ui.error(error instanceof Error ? error.message : 'Unknown error');
        }

        console.log(); // Blank line between interactions
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
  .option('-p, --path <path>', 'Working directory', '.')
  .action(async (task, options) => {
    const cwd = resolve(options.path);
    
    if (!existsSync(cwd)) {
      console.error(`Path not found: ${cwd}`);
      process.exit(1);
    }

    const config = loadConfig();
    
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

      const memory = new MemoryManager({
        dbPath: config.memory.dbPath,
        embeddingModel: config.memory.embeddingModel,
        maxWorkingTokens: config.memory.maxWorkingTokens,
        recallThreshold: config.memory.recallThreshold,
        maxRecalledMemories: config.memory.maxRecalledMemories,
      });

      await memory.initialize();

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

      const agent = new Agent({
        kimi,
        memory,
        tools,
        ui,
        maxIterations: config.agent.maxIterations,
      });

      await agent.run(task, cwd);
      
      memory.close();
      
    } catch (error) {
      ui.error(error instanceof Error ? error.message : 'Task failed');
      process.exit(1);
    }
  });

program
  .command('sessions')
  .description('List all saved sessions')
  .action(async () => {
    const config = loadConfig();
    
    const memory = new MemoryManager({
      dbPath: config.memory.dbPath,
      embeddingModel: config.memory.embeddingModel,
      maxWorkingTokens: config.memory.maxWorkingTokens,
      recallThreshold: config.memory.recallThreshold,
      maxRecalledMemories: config.memory.maxRecalledMemories,
    });

    await memory.initialize();

    // Query sessions from database
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
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log('Current configuration:\n');
    console.log(JSON.stringify(config, null, 2));
  });

// Import chalk for the CLI
import chalk from 'chalk';

program.parse();
