import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Config {
  provider: {
    apiKey: string;
    model: 'kimi-k2-5' | 'kimi-k2-6' | 'kimi-k2-6-preview' | 'kimi-latest';
    baseUrl: string;
  };
  memory: {
    dbPath: string;
    embeddingModel: string;
    maxWorkingTokens: number;
    recallThreshold: number;
    maxRecalledMemories: number;
  };
  agent: {
    mode: 'auto' | 'semi' | 'review';
    maxIterations: number;
    showMemoryOperations: boolean;
    verbosity: 'quiet' | 'normal' | 'verbose';
  };
  workspace: {
    defaultPath: string;
    autoIndex: boolean;
  };
}

const DEFAULT_CONFIG: Config = {
  provider: {
    apiKey: '',
    model: 'kimi-k2-5',
    baseUrl: 'https://api.moonshot.ai/v1',  // Moonshot International/US endpoint
  },
  memory: {
    dbPath: '~/.horus/memory.db',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    maxWorkingTokens: 50000,
    recallThreshold: 0.5,
    maxRecalledMemories: 10,
  },
  agent: {
    mode: 'semi',
    maxIterations: 50,
    showMemoryOperations: true,
    verbosity: 'normal',
  },
  workspace: {
    defaultPath: '~/workspace',
    autoIndex: true,
  },
};

export function loadConfig(): Config {
  const configPath = join(homedir(), '.horus', 'config.json');

  if (!existsSync(configPath)) {
    return createDefaultConfig(configPath);
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    return mergeWithDefaults(parsed);
  } catch (error) {
    console.warn('Failed to load config, using defaults:', error);
    return DEFAULT_CONFIG;
  }
}

function createDefaultConfig(configPath: string): Config {
  const configDir = join(homedir(), '.horus');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Read API key from environment if available
  const apiKey = process.env.KIMI_API_KEY || '';
  const config = {
    ...DEFAULT_CONFIG,
    provider: {
      ...DEFAULT_CONFIG.provider,
      apiKey,
    },
  };

  // Write default config
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Created default config at ${configPath}`);
  
  if (!apiKey) {
    console.log('Please set your KIMI_API_KEY in the config or environment');
  }

  return config;
}

function mergeWithDefaults(parsed: Partial<Config>): Config {
  return {
    provider: {
      ...DEFAULT_CONFIG.provider,
      ...parsed.provider,
      apiKey: parsed.provider?.apiKey || process.env.KIMI_API_KEY || '',
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...parsed.memory,
    },
    agent: {
      ...DEFAULT_CONFIG.agent,
      ...parsed.agent,
    },
    workspace: {
      ...DEFAULT_CONFIG.workspace,
      ...parsed.workspace,
    },
  };
}

export function getConfigPath(): string {
  return join(homedir(), '.horus', 'config.json');
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
