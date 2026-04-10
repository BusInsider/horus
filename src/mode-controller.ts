// Kimi-native mode controller - Refined for always-available tooling
// All modes have tool access; differences are in temperature, latency, and parallelism

export type ModeType = 'fast' | 'balanced' | 'thorough' | 'swarm';

export interface ModeConfig {
  name: string;
  description: string;
  temperature: number;
  topP: number;
  thinking: { type: 'enabled' | 'disabled' };
  toolsEnabled: boolean; // Always true now, kept for compatibility
  maxTokens: number;
  costPerMInput: number;
  costPerMOutput: number;
  useCase: string;
  /** Whether to automatically show reasoning_content to user */
  showThinking: boolean;
  /** Expected latency tier */
  latency: 'low' | 'medium' | 'high';
}

export const MODE_CONFIGS: Record<ModeType, ModeConfig> = {
  fast: {
    name: 'Fast',
    description: 'Quick responses with deterministic output - tools always available',
    temperature: 0.6,
    topP: 0.95,
    thinking: { type: 'disabled' },
    toolsEnabled: true, // ALWAYS true - never kneecap the agent
    maxTokens: 2000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Quick edits, file lookups, simple automation (cheap & fast)',
    showThinking: false,
    latency: 'low',
  },
  balanced: {
    name: 'Balanced',
    description: 'Standard agent mode with full tool access - the default',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: true,
    maxTokens: 4000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Code editing, debugging, multi-step tasks (default)',
    showThinking: false,
    latency: 'medium',
  },
  thorough: {
    name: 'Thorough',
    description: 'Deep reasoning with visible thinking - tools always available',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: true,
    maxTokens: 4000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Complex refactoring, architecture decisions, novel problems',
    showThinking: true,
    latency: 'medium',
  },
  swarm: {
    name: 'Swarm',
    description: 'Parallel sub-agent execution for complex objectives',
    temperature: 1.0,
    topP: 0.95,
    thinking: { type: 'enabled' },
    toolsEnabled: true,
    maxTokens: 4000,
    costPerMInput: 0.60,
    costPerMOutput: 2.50,
    useCase: 'Large tasks, multi-file refactoring, exploration',
    showThinking: false,
    latency: 'high',
  },
};

// Legacy mode mappings for backwards compatibility
const LEGACY_MODE_MAP: Record<string, ModeType> = {
  'instant': 'fast',
  'thinking': 'thorough',
  'agent': 'balanced',
  'swarm': 'swarm',
};

export class ModeController {
  private currentMode: ModeType = 'balanced';

  setMode(mode: ModeType | string): void {
    // Handle legacy mode names
    if (mode in LEGACY_MODE_MAP) {
      mode = LEGACY_MODE_MAP[mode];
    }
    
    if (!(mode in MODE_CONFIGS)) {
      throw new Error(
        `Invalid mode: ${mode}. Available modes: ${Object.keys(MODE_CONFIGS).join(', ')}`
      );
    }
    
    this.currentMode = mode as ModeType;
  }

  getMode(): ModeType {
    return this.currentMode;
  }

  getConfig(): ModeConfig {
    return MODE_CONFIGS[this.currentMode];
  }

  /**
   * Tools are ALWAYS enabled in all modes.
   * This method is kept for API compatibility.
   */
  isToolEnabled(): boolean {
    return true; // Always true - tools are never disabled
  }

  getTemperature(): number {
    return MODE_CONFIGS[this.currentMode].temperature;
  }

  getThinkingConfig(): { type: 'enabled' | 'disabled' } {
    return MODE_CONFIGS[this.currentMode].thinking;
  }

  /**
   * Whether to show reasoning_content to user.
   * This is different from whether thinking is enabled in the API.
   */
  shouldShowThinking(): boolean {
    return MODE_CONFIGS[this.currentMode].showThinking;
  }

  /**
   * Estimate cost for a given token usage
   */
  estimateCost(inputTokens: number, outputTokens: number): number {
    const config = this.getConfig();
    const inputCost = (inputTokens / 1_000_000) * config.costPerMInput;
    const outputCost = (outputTokens / 1_000_000) * config.costPerMOutput;
    return inputCost + outputCost;
  }

  /**
   * Get estimated latency tier for this mode
   */
  getLatency(): 'low' | 'medium' | 'high' {
    return MODE_CONFIGS[this.currentMode].latency;
  }

  /**
   * Get a user-friendly description of current mode
   */
  getStatusLine(): string {
    const config = this.getConfig();
    return `${config.name} mode | Temp: ${config.temperature} | Tools: enabled | Latency: ${config.latency}`;
  }

  static getAvailableModes(): Array<{ type: ModeType; config: ModeConfig }> {
    return Object.entries(MODE_CONFIGS).map(([type, config]) => ({
      type: type as ModeType,
      config,
    }));
  }

  static validateMode(mode: string): ModeType {
    // Check legacy names first
    if (mode in LEGACY_MODE_MAP) {
      return LEGACY_MODE_MAP[mode];
    }
    
    if (mode in MODE_CONFIGS) {
      return mode as ModeType;
    }
    
    throw new Error(
      `Invalid mode: ${mode}. Available modes: ${Object.keys(MODE_CONFIGS).join(', ')}`
    );
  }

  /**
   * Get all valid mode names including legacy aliases
   */
  static getAllModeNames(): string[] {
    return [...Object.keys(MODE_CONFIGS), ...Object.keys(LEGACY_MODE_MAP)];
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

export function setGlobalMode(mode: ModeType | string): void {
  getModeController().setMode(mode);
}

/**
 * Auto-detect the best mode for a given user input.
 * This is a simple heuristic - can be expanded with ML in the future.
 */
export function suggestMode(input: string): ModeType {
  const lower = input.toLowerCase();
  
  // Simple heuristics
  const isQuickLookup = /^(find|show|get|list|cat|ls|grep|search)\b/.test(lower);
  const isComplexTask = /(refactor|implement|create|add|fix|debug|analyze)\b/.test(lower) 
    && input.length > 50;
  const isMultiFile = /\b(all files|every file|project.?(wide|level)|multiple files)\b/.test(lower);
  
  if (isQuickLookup && !isComplexTask) {
    return 'fast';
  }
  
  if (isMultiFile || input.length > 200) {
    return 'swarm';
  }
  
  return 'balanced';
}
