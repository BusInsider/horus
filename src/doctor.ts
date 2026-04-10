// Diagnostic command for Horus
// Checks system health, configuration, and dependencies

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, getConfigPath } from './config.js';
import { expandHomeDir } from './utils/paths.js';

export interface DiagnosticResult {
  category: string;
  check: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  fix?: string;
}

export class Doctor {
  private results: DiagnosticResult[] = [];

  async runAllChecks(): Promise<DiagnosticResult[]> {
    this.results = [];

    await this.checkNodeVersion();
    await this.checkDependencies();
    await this.checkConfig();
    await this.checkApiConnection();
    await this.checkTools();
    await this.checkWorkspace();
    await this.checkMemory();
    await this.checkGit();

    return this.results;
  }

  private addResult(category: string, check: string, status: DiagnosticResult['status'], message: string, fix?: string) {
    this.results.push({ category, check, status, message, fix });
  }

  async checkNodeVersion(): Promise<void> {
    try {
      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0]);

      if (major >= 20) {
        this.addResult('Environment', 'Node.js Version', 'pass', `Node ${version} (>= 20 recommended)`);
      } else if (major >= 18) {
        this.addResult('Environment', 'Node.js Version', 'warn', `Node ${version} (>= 20 recommended for best performance)`);
      } else {
        this.addResult('Environment', 'Node.js Version', 'fail', `Node ${version} (>= 18 required, >= 20 recommended)`);
      }
    } catch (error) {
      this.addResult('Environment', 'Node.js Version', 'fail', 'Could not determine Node.js version');
    }
  }

  async checkDependencies(): Promise<void> {
    // These are the external dependencies (not bundled)
    const externalDeps = ['better-sqlite3', '@xenova/transformers'];
    // These are bundled into the CLI
    const bundledDeps = ['chalk', 'commander'];

    // Check external deps by trying to resolve them
    for (const dep of externalDeps) {
      try {
        // Use require.resolve to find the module
        require.resolve(dep);
        this.addResult('Dependencies', dep, 'pass', 'Installed');
      } catch {
        // Check if installed in horus node_modules
        try {
          const horusNodeModules = join(process.env.HOME || '', '.hermes', 'workspace', 'horus', 'node_modules', dep);
          await fs.access(horusNodeModules);
          this.addResult('Dependencies', dep, 'pass', 'Installed');
        } catch {
          this.addResult('Dependencies', dep, 'fail', 'Not installed', `cd ~/.hermes/workspace/horus && npm install ${dep}`);
        }
      }
    }

    // Bundled deps are always available
    for (const dep of bundledDeps) {
      this.addResult('Dependencies', dep, 'pass', 'Bundled');
    }
  }

  async checkConfig(): Promise<void> {
    try {
      const configPath = getConfigPath();
      await fs.access(configPath);
      this.addResult('Configuration', 'Config File', 'pass', `Found at ${configPath}`);

      const config = loadConfig();

      // Check API key
      if (config.provider.apiKey) {
        const masked = config.provider.apiKey.substring(0, 8) + '...' + config.provider.apiKey.slice(-4);
        this.addResult('Configuration', 'API Key', 'pass', `Set (${masked})`);
      } else {
        this.addResult('Configuration', 'API Key', 'fail', 'Not configured', 'Set KIMI_API_KEY environment variable or run `horus configure`');
      }

      // Check model
      const validModels = ['kimi-k2-5', 'kimi-latest'];
      if (validModels.includes(config.provider.model)) {
        this.addResult('Configuration', 'Model', 'pass', config.provider.model);
      } else {
        this.addResult('Configuration', 'Model', 'warn', `${config.provider.model} (may not be supported)`);
      }

      // Check endpoint type
      let endpointType: string;
      if (config.provider.baseUrl.includes('kimi.com')) {
        endpointType = 'Kimi Coding (sk-kimi- keys)';
      } else if (config.provider.baseUrl.includes('.cn')) {
        endpointType = 'Moonshot China';
      } else {
        endpointType = 'Moonshot International/US';
      }
      this.addResult('Configuration', 'API Endpoint', 'pass', `${endpointType} - ${config.provider.baseUrl}`);

      // Check workspace
      const workspacePath = expandHomeDir(config.workspace.defaultPath);
      try {
        await fs.access(workspacePath);
        this.addResult('Configuration', 'Workspace', 'pass', workspacePath);
      } catch {
        this.addResult('Configuration', 'Workspace', 'warn', `${workspacePath} does not exist`, `mkdir -p ${workspacePath} or run \\\`horus workspace <path>\\\``);
      }

    } catch (error) {
      this.addResult('Configuration', 'Config File', 'fail', 'Could not load configuration', 'Run `horus init` to create configuration');
    }
  }

  async checkApiConnection(): Promise<void> {
    const config = loadConfig();

    if (!config.provider.apiKey) {
      this.addResult('API', 'Connection Test', 'warn', 'Skipped (no API key)');
      return;
    }

    try {
      const { KimiClient } = await import('./kimi.js');
      const client = new KimiClient({
        apiKey: config.provider.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
      });

      // Quick test
      await client.complete([{ role: 'user', content: 'Hi' }], { maxTokens: 5 });
      this.addResult('API', 'Connection Test', 'pass', `Connected to ${config.provider.baseUrl}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const is401 = message.includes('401') || message.includes('Invalid Authentication');
      
      let fix = 'Check API key and network connection';
      if (is401) {
        if (config.provider.baseUrl.includes('kimi.com')) {
          fix = 'Your key may not be a sk-kimi- key, or lacks Coding access. Run `horus configure` and select moonshot-us for standard access';
        } else if (config.provider.baseUrl.includes('.cn')) {
          fix = 'Your key may not be a Moonshot China key. Run `horus configure` and select the correct key type';
        } else {
          fix = 'Your key may not be a Moonshot International key. Run `horus configure` and select the correct key type';
        }
      }
      
      this.addResult('API', 'Connection Test', 'fail', message, fix);
    }
  }

  async checkTools(): Promise<void> {
    const tools = [
      { name: 'git', required: true },
      { name: 'node', required: true },
      { name: 'npm', required: true },
      { name: 'ripgrep', required: false, alt: 'rg' },
    ];

    for (const tool of tools) {
      try {
        const cmd = tool.alt || tool.name;
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        this.addResult('Tools', tool.name, 'pass', 'Available');
      } catch {
        const status = tool.required ? 'fail' : 'warn';
        this.addResult('Tools', tool.name, status, 'Not found', `Install ${tool.name}`);
      }
    }
  }

  async checkWorkspace(): Promise<void> {
    const config = loadConfig();
    const workspacePath = expandHomeDir(config.workspace.defaultPath);

    try {
      const stats = await fs.stat(workspacePath);
      if (stats.isDirectory()) {
        this.addResult('Workspace', 'Directory', 'pass', workspacePath);

        // Check permissions
        try {
          const testFile = join(workspacePath, '.horus_write_test');
          await fs.writeFile(testFile, '', 'utf-8');
          await fs.unlink(testFile);
          this.addResult('Workspace', 'Permissions', 'pass', 'Read/Write access');
        } catch {
          this.addResult('Workspace', 'Permissions', 'fail', 'Cannot write to workspace', 'Check directory permissions');
        }
      } else {
        this.addResult('Workspace', 'Directory', 'fail', `${workspacePath} is not a directory`);
      }
    } catch {
      this.addResult('Workspace', 'Directory', 'fail', `${workspacePath} does not exist`, `Create directory: mkdir -p ${workspacePath}`);
    }
  }

  async checkMemory(): Promise<void> {
    const config = loadConfig();
    const dbPath = expandHomeDir(config.memory.dbPath);

    try {
      const stats = await fs.stat(dbPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      this.addResult('Memory', 'Database', 'pass', `${dbPath} (${sizeMB} MB)`);
    } catch {
      this.addResult('Memory', 'Database', 'warn', 'Database does not exist yet (will be created on first run)');
    }

    // Check disk space
    try {
      const { statfs } = await import('fs');
      const homedir = expandHomeDir('~');
      const stats = await new Promise<any>((resolve, reject) => {
        statfs(homedir, (err: any, stats: any) => {
          if (err) reject(err);
          else resolve(stats);
        });
      });

      const freeGB = (stats.bfree * stats.bsize / 1024 / 1024 / 1024).toFixed(2);
      if (stats.bfree * stats.bsize > 1024 * 1024 * 1024) { // > 1GB
        this.addResult('Memory', 'Disk Space', 'pass', `${freeGB} GB free`);
      } else {
        this.addResult('Memory', 'Disk Space', 'warn', `${freeGB} GB free (may be insufficient for large projects)`);
      }
    } catch {
      this.addResult('Memory', 'Disk Space', 'warn', 'Could not determine disk space');
    }
  }

  async checkGit(): Promise<void> {
    try {
      execSync('which git', { stdio: 'ignore' });

      // Check git config
      const name = execSync('git config user.name', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      const email = execSync('git config user.email', { encoding: 'utf-8', stdio: 'pipe' }).trim();

      if (name && email) {
        this.addResult('Git', 'Configuration', 'pass', `${name} <${email}>`);
      } else {
        this.addResult('Git', 'Configuration', 'warn', 'User name/email not set', 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"');
      }
    } catch {
      this.addResult('Git', 'Git', 'fail', 'Git not found', 'Install git');
    }
  }

  printReport(): void {
    console.log(chalk.blue('\n🧠 Horus Doctor - Diagnostic Report\n'));

    const categories = [...new Set(this.results.map(r => r.category))];

    for (const category of categories) {
      console.log(chalk.yellow(`${category}:`));

      const categoryResults = this.results.filter(r => r.category === category);
      for (const result of categoryResults) {
        const icon = result.status === 'pass' ? chalk.green('✅') :
                     result.status === 'warn' ? chalk.yellow('⚠️') :
                     result.status === 'skip' ? chalk.gray('⏭️') :
                     chalk.red('❌');

        console.log(`  ${icon} ${result.check}: ${result.message}`);

        if (result.fix) {
          console.log(chalk.cyan(`     Fix: ${result.fix}`));
        }
      }
      console.log();
    }

    const passed = this.results.filter(r => r.status === 'pass').length;
    const warnings = this.results.filter(r => r.status === 'warn').length;
    const failed = this.results.filter(r => r.status === 'fail').length;

    console.log(chalk.blue('Summary:'));
    console.log(`  ${chalk.green(`${passed} passed`)}`);
    if (warnings > 0) console.log(`  ${chalk.yellow(`${warnings} warnings`)}`);
    if (failed > 0) console.log(`  ${chalk.red(`${failed} failed`)}`);
    console.log();

    if (failed === 0 && warnings === 0) {
      console.log(chalk.green('✅ All checks passed! Horus is ready to use.\n'));
    } else if (failed === 0) {
      console.log(chalk.yellow('⚠️  Some warnings. Horus should work but may have issues.\n'));
    } else {
      console.log(chalk.red('❌ Some checks failed. Please fix the issues above before using Horus.\n'));
    }
  }
}

export async function runDoctor(): Promise<void> {
  const doctor = new Doctor();
  await doctor.runAllChecks();
  doctor.printReport();
}
