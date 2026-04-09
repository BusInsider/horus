// Kimi-native mode controller - Four modes: instant, thinking, agent, swarm
// Optimized for Kimi K2.5's MoE architecture and pricing tiers

export type ModeType = 'instant' | 'thinking' | 'agent' | 'swarm';

export interface ModeConfig {
  name: string;
  description: string;
  temperature: number;
  topP: number;
  thinking: { type: 'enabled' | 'disabled' };
  toolsEnabled: boolean;
  maxTokens: number;
  costPerMInput: number;
  costPerMOutput: number;
  useCase: string;
}

export const MODE_CONFIGS: Record<ModeType, ModeConfig> = {
  instant: {
    name: 'Instant',
    description: 'Quick responses with minimal latency',
    temperature: 0.6,
    topP: 0.95,
    thinking: { type: 'disabled' },
    toolsEnabled: false,
    maxTokens: 2000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Simple Q&A, code explanation, quick lookups',
  },
  thinking: {
    name: 'Thinking',
    description: 'Complex reasoning with chain-of-thought',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: false,
    maxTokens: 4000,
    costPerMInput: 0.60, // Same pricing, just different mode
    costPerMOutput: 2.50,
    useCase: 'Problem decomposition, novel solutions, deep analysis',
  },
  agent: {
    name: 'Agent',
    description: 'Multi-tool workflows with reasoning',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: true,
    maxTokens: 4000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'File operations, code editing, multi-step tasks (default)',
  },
  swarm: {
    name: 'Swarm',
    description: 'Parallel sub-agent execution',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: true,
    maxTokens: 4000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Batch processing, multi-domain research, parallel exploration',
  },
};

export class ModeController {
  private currentMode: ModeType = 'agent';

  setMode(mode: ModeType): void {
    this.currentMode = mode;
  }

  getMode(): ModeType {
    return this.currentMode;
  }

  getConfig(): ModeConfig {
    return MODE_CONFIGS[this.currentMode];
  }

  isToolEnabled(): boolean {
    return MODE_CONFIGS[this.currentMode].toolsEnabled;
  }

  getTemperature(): number {
    return MODE_CONFIGS[this.currentMode].temperature;
  }

  getThinkingConfig(): { type: 'enabled' | 'disabled' } {
    return MODE_CONFIGS[this.currentMode].thinking;
  }

  shouldShowThinking(): boolean {
    return MODE_CONFIGS[this.currentMode].thinking.type === 'enabled';
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    const config = this.getConfig();
    const inputCost = (inputTokens / 1_000_000) * config.costPerMInput;
    const outputCost = (outputTokens / 1_000_000) * config.costPerMOutput;
    return inputCost + outputCost;
  }

  static getAvailableModes(): Array<{ type: ModeType; config: ModeConfig }> {
    return Object.entries(MODE_CONFIGS).map(([type, config]) => ({
      type: type as ModeType,
      config,
    }));
  }

  static validateMode(mode: string): ModeType {
    if (mode in MODE_CONFIGS) {
      return mode as ModeType;
    }
    throw new Error(
      `Invalid mode: ${mode}. Available modes: ${Object.keys(MODE_CONFIGS).join(', ')}`
    );
  }
}

// Singleton instance
let globalModeController: ModeController | null = null;

export function getModeController(): ModeController {
  if (!globalModeController) {
    globalModeController = new ModeController();
  }
  return globalModeController;
}

export function setGlobalMode(mode: ModeType): void {
  getModeController().setMode(mode);
}
