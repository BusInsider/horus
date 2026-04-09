// Configuration wizard and management for Horus
// Interactive setup, validation, and management

import { promises as fs } from 'fs';
import { resolve } from 'path';
import readline from 'readline';
import { loadConfig, saveConfig, Config, getConfigPath } from './config.js';
import { expandHomeDir } from './utils/paths.js';
import chalk from 'chalk';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function askYesNo(question: string, defaultValue: boolean = false): Promise<boolean> {
  const defaultStr = defaultValue ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultStr}] `, (answer) => {
      const lower = answer.toLowerCase().trim();
      if (lower === 'y' || lower === 'yes') resolve(true);
      else if (lower === 'n' || lower === 'no') resolve(false);
      else resolve(defaultValue);
    });
  });
}

export async function runConfigureWizard(): Promise<void> {
  console.log(chalk.blue('\n🧠 Horus Configuration Wizard\n'));
  console.log('This will guide you through setting up Horus.\n');

  const config = loadConfig();

  // Step 1: API Configuration
  console.log(chalk.yellow('Step 1: API Configuration'));
  console.log('Horus uses Kimi K2.5 by default.\n');

  const apiKey = await ask(`API Key ${config.provider.apiKey ? '(currently set, press Enter to keep)' : '(required)'}: `);
  if (apiKey.trim()) {
    config.provider.apiKey = apiKey.trim();
  }

  // API Key type selection (important for API key compatibility)
  console.log(chalk.gray('\n  Note: Different API key types use different endpoints.'));
  console.log(chalk.gray('  - Moonshot keys (most common): api.moonshot.ai/v1 (International/US)'));
  console.log(chalk.gray('  - Moonshot China keys: api.moonshot.cn/v1'));
  console.log(chalk.gray('  - Kimi Coding keys: api.kimi.com/coding/v1 (requires special access)'));
  const keyType = await ask(`Key type (moonshot-us/moonshot-cn/kimi) [moonshot-us]: `);
  const keyTypeLower = keyType.trim().toLowerCase();
  if (keyTypeLower === 'moonshot-cn') {
    config.provider.baseUrl = 'https://api.moonshot.cn/v1';
    console.log(chalk.gray('  Using Moonshot China endpoint: api.moonshot.cn/v1'));
  } else if (keyTypeLower === 'kimi') {
    config.provider.baseUrl = 'https://api.kimi.com/coding/v1';
    console.log(chalk.gray('  Using Kimi Coding endpoint: api.kimi.com/coding/v1'));
  } else {
    config.provider.baseUrl = 'https://api.moonshot.ai/v1';
    console.log(chalk.gray('  Using Moonshot International/US endpoint: api.moonshot.ai/v1'));
  }

  const model = await ask(`Model [${config.provider.model}]: `);
  if (model.trim()) {
    config.provider.model = model as 'kimi-k2-5' | 'kimi-latest';
  }

  // Step 2: Workspace
  console.log(chalk.yellow('\nStep 2: Workspace Configuration'));
  const workspace = await ask(`Default workspace path [${config.workspace.defaultPath}]: `);
  if (workspace.trim()) {
    const expanded = expandHomeDir(workspace.trim());
    if (!(await fs.stat(expanded).catch(() => null))) {
      const create = await askYesNo(`Directory doesn't exist. Create it?`, true);
      if (create) {
        await fs.mkdir(expanded, { recursive: true });
      }
    }
    config.workspace.defaultPath = workspace.trim();
  }

  const autoIndex = await askYesNo('Auto-index workspace on startup?', config.workspace.autoIndex);
  config.workspace.autoIndex = autoIndex;

  // Step 3: Agent Behavior
  console.log(chalk.yellow('\nStep 3: Agent Behavior'));
  console.log('Mode determines how autonomous Horus is:\n');
  console.log('  auto   - Execute tools without confirmation (fastest)');
  console.log('  semi   - Ask before destructive operations (recommended)');
  console.log('  review - Stop after each step for approval (safest)\n');

  const modeInput = await ask(`Mode [${config.agent.mode}]: `);
  if (modeInput.trim() && ['auto', 'semi', 'review'].includes(modeInput.trim())) {
    config.agent.mode = modeInput.trim() as 'auto' | 'semi' | 'review';
  }

  const maxIterations = await ask(`Max iterations per task [${config.agent.maxIterations}]: `);
  if (maxIterations.trim() && !isNaN(parseInt(maxIterations))) {
    config.agent.maxIterations = parseInt(maxIterations);
  }

  // Step 4: Memory Configuration
  console.log(chalk.yellow('\nStep 4: Memory Configuration'));
  const maxTokens = await ask(`Max working memory tokens [${config.memory.maxWorkingTokens}]: `);
  if (maxTokens.trim() && !isNaN(parseInt(maxTokens))) {
    config.memory.maxWorkingTokens = parseInt(maxTokens);
  }

  // Save configuration
  console.log(chalk.green('\nSaving configuration...'));
  saveConfig(config);

  console.log(chalk.green(`✅ Configuration saved to ${getConfigPath()}\n`));

  // Test connection
  const testConnection = await askYesNo('Test API connection now?', true);
  if (testConnection) {
    await testApiConnection(config);
  }

  console.log(chalk.blue('\n🚀 Horus is ready to use!'));
  console.log('\nQuick start:');
  console.log('  horus chat              # Start interactive session');
  console.log('  horus run "task"        # Execute single task');
  console.log('  horus config            # View configuration\n');

  rl.close();
}

export async function testApiConnection(config?: Config): Promise<boolean> {
  const cfg = config || loadConfig();

  console.log(chalk.blue('\nTesting API connection...'));

  if (!cfg.provider.apiKey) {
    console.log(chalk.red('❌ No API key configured'));
    return false;
  }

  try {
    const { KimiClient } = await import('./kimi.js');
    const client = new KimiClient({
      apiKey: cfg.provider.apiKey,
      baseUrl: cfg.provider.baseUrl,
      model: cfg.provider.model,
    });

    // Simple test request
    const response = await client.complete([
      { role: 'user', content: 'Say "Horus connection test successful" and nothing else.' }
    ], { maxTokens: 20 });

    if (response.toLowerCase().includes('successful') || response.toLowerCase().includes('horus')) {
      console.log(chalk.green('✅ API connection successful!'));
      console.log(`   Model: ${cfg.provider.model}`);
      console.log(`   Response: ${response.trim()}\n`);
      return true;
    } else {
      console.log(chalk.yellow('⚠️  Unexpected response from API:'));
      console.log(`   ${response}\n`);
      return false;
    }
  } catch (error) {
    console.log(chalk.red('❌ API connection failed:'));
    console.log(`   ${error instanceof Error ? error.message : error}\n`);
    return false;
  }
}

export async function showConfiguration(): Promise<void> {
  const config = loadConfig();
  const configPath = getConfigPath();

  console.log(chalk.blue('\n🧠 Horus Configuration\n'));
  console.log(`Config file: ${configPath}\n`);

  // Mask API key for display
  const maskedKey = config.provider.apiKey
    ? config.provider.apiKey.substring(0, 8) + '...' + config.provider.apiKey.substring(config.provider.apiKey.length - 4)
    : '(not set)';

  console.log(chalk.yellow('Provider:'));
  console.log(`  API Key: ${maskedKey}`);
  console.log(`  Model: ${config.provider.model}`);
  console.log(`  Base URL: ${config.provider.baseUrl}`);

  console.log(chalk.yellow('\nWorkspace:'));
  console.log(`  Default Path: ${config.workspace.defaultPath}`);
  console.log(`  Auto Index: ${config.workspace.autoIndex ? 'Yes' : 'No'}`);

  console.log(chalk.yellow('\nAgent:'));
  console.log(`  Mode: ${config.agent.mode}`);
  console.log(`  Max Iterations: ${config.agent.maxIterations}`);
  console.log(`  Show Memory Operations: ${config.agent.showMemoryOperations ? 'Yes' : 'No'}`);

  console.log(chalk.yellow('\nMemory:'));
  console.log(`  DB Path: ${config.memory.dbPath}`);
  console.log(`  Max Working Tokens: ${config.memory.maxWorkingTokens}`);
  console.log(`  Recall Threshold: ${config.memory.recallThreshold}`);
  console.log(`  Max Recalled Memories: ${config.memory.maxRecalledMemories}`);

  // Check database size
  try {
    const dbPath = expandHomeDir(config.memory.dbPath);
    const stats = await fs.stat(dbPath).catch(() => null);
    if (stats) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(chalk.yellow('\nDatabase:'));
      console.log(`  Size: ${sizeMB} MB`);
    }
  } catch {}

  console.log('');
}

export async function resetConfiguration(): Promise<void> {
  console.log(chalk.yellow('\n⚠️  This will reset all configuration to defaults.\n'));

  const confirm = await askYesNo('Are you sure?', false);
  if (!confirm) {
    console.log('Cancelled.\n');
    return;
  }

  const defaultConfig: Config = {
    provider: {
      apiKey: '',
      model: 'kimi-k2-5',
      baseUrl: 'https://api.moonshot.cn/v1',
    },
    memory: {
      dbPath: '~/.horus/memory.db',
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      maxWorkingTokens: 50000,
      recallThreshold: 0.7,
      maxRecalledMemories: 10,
    },
    agent: {
      mode: 'semi',
      maxIterations: 50,
      showMemoryOperations: true,
    },
    workspace: {
      defaultPath: '~/workspace',
      autoIndex: true,
    },
  };

  saveConfig(defaultConfig);
  console.log(chalk.green('\n✅ Configuration reset to defaults.\n'));
}

export async function configureMcp(): Promise<void> {
  console.log(chalk.blue('\n🔌 MCP Server Configuration\n'));
  console.log('MCP (Model Context Protocol) allows connecting to external tool servers.\n');

  const config = loadConfig();

  // This is a placeholder - MCP config would be added to config structure
  console.log('Example MCP servers you can add:');
  console.log('  - filesystem: Access local files securely');
  console.log('  - github: GitHub API integration');
  console.log('  - fetch: Web fetching capabilities\n');

  console.log(chalk.yellow('To add MCP servers, edit your config file:'));
  console.log(`  ${getConfigPath()}\n`);

  console.log('Example MCP configuration:');
  console.log(JSON.stringify({
    mcp: {
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed'],
        },
      },
    },
  }, null, 2));

  console.log('');
}
