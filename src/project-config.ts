// Project-level configuration (.horusrc) support
// Allows per-project settings that override global config

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { type Config } from './config.js';

export interface ProjectConfig extends Partial<Config> {
  // Project-specific overrides
  project?: {
    name?: string;
    description?: string;
    ignorePatterns?: string[];
    autoIndex?: boolean;
  };
  // Tool-specific settings
  tools?: {
    bash?: {
      allowedCommands?: string[];
      blockedCommands?: string[];
    };
    edit?: {
      autoFormat?: boolean;
      confirmDestructive?: boolean;
    };
  };
}

const HORUSRC_FILES = ['.horusrc', '.horusrc.json', '.horusrc.js'];

export class ProjectConfigManager {
  private projectRoot: string | null = null;
  private config: ProjectConfig | null = null;

  async findProjectRoot(startPath: string = process.cwd()): Promise<string | null> {
    let current = resolve(startPath);

    while (true) {
      for (const file of HORUSRC_FILES) {
        const filepath = join(current, file);
        try {
          await fs.access(filepath);
          this.projectRoot = current;
          return current;
        } catch {
          // Continue searching
        }
      }

      // Check for git root as fallback
      try {
        await fs.access(join(current, '.git'));
        this.projectRoot = current;
        return current;
      } catch {
        // Continue searching
      }

      const parent = resolve(current, '..');
      if (parent === current) {
        // Reached filesystem root
        return null;
      }
      current = parent;
    }
  }

  async loadConfig(startPath?: string): Promise<ProjectConfig | null> {
    const root = await this.findProjectRoot(startPath);
    if (!root) return null;

    for (const file of HORUSRC_FILES) {
      const filepath = join(root, file);
      try {
        const content = await fs.readFile(filepath, 'utf-8');
        
        if (file.endsWith('.js')) {
          // JS config - require it
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          this.config = require(filepath);
        } else {
          // JSON config
          this.config = JSON.parse(content);
        }

        this.config = this.validateConfig(this.config);
        return this.config;
      } catch {
        // Try next file
      }
    }

    return null;
  }

  async createConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
    const filepath = join(projectRoot, '.horusrc.json');
    await fs.writeFile(filepath, JSON.stringify(config, null, 2), 'utf-8');
    this.config = config;
    this.projectRoot = projectRoot;
  }

  getConfig(): ProjectConfig | null {
    return this.config;
  }

  getProjectRoot(): string | null {
    return this.projectRoot;
  }

  isProjectRoot(path: string): boolean {
    return this.projectRoot === resolve(path);
  }

  mergeWithGlobal(globalConfig: Config): Config {
    if (!this.config) return globalConfig;

    // Deep merge
    return {
      ...globalConfig,
      ...this.config,
      provider: {
        ...globalConfig.provider,
        ...this.config.provider,
      },
      memory: {
        ...globalConfig.memory,
        ...this.config.memory,
      },
      agent: {
        ...globalConfig.agent,
        ...this.config.agent,
      },
      workspace: {
        ...globalConfig.workspace,
        ...this.config.workspace,
      },
    };
  }

  private validateConfig(config: any): ProjectConfig {
    // Basic validation and defaults
    return {
      ...config,
      project: {
        autoIndex: true,
        ...config?.project,
      },
    };
  }

  getIgnorePatterns(): string[] {
    const defaults = [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '.env*',
      '*.log',
    ];

    if (!this.config?.project?.ignorePatterns) {
      return defaults;
    }

    return [...defaults, ...this.config.project.ignorePatterns];
  }
}

// Global instance
let globalProjectConfig: ProjectConfigManager | null = null;

export function getProjectConfigManager(): ProjectConfigManager {
  if (!globalProjectConfig) {
    globalProjectConfig = new ProjectConfigManager();
  }
  return globalProjectConfig;
}
