// Token management for context window optimization
// Tracks and manages token usage to stay within limits

import { Logger } from './utils/logger.js';

export interface TokenBudget {
  maxTokens: number;
  reserveTokens: number;      // Reserved for response
  warningThreshold: number;   // Warn at % of max
  compressionThreshold: number; // Compress at % of max
}

export interface TokenUsage {
  system: number;
  messages: number;
  tools: number;
  workingMemory: number;
  total: number;
  available: number;
}

export interface TierUsage {
  tier: number;
  tokens: number;
  items: number;
}

export class TokenManager {
  private budget: TokenBudget;
  private logger: Logger;
  private usage: TokenUsage;
  private tierUsage: TierUsage[] = [];

  constructor(budget?: Partial<TokenBudget>, logger?: Logger) {
    this.budget = {
      maxTokens: 256000,
      reserveTokens: 32000,
      warningThreshold: 0.8,
      compressionThreshold: 0.9,
      ...budget,
    };
    this.logger = logger || new Logger('token-manager');
    this.usage = this.resetUsage();
  }

  resetUsage(): TokenUsage {
    this.usage = {
      system: 0,
      messages: 0,
      tools: 0,
      workingMemory: 0,
      total: 0,
      available: this.budget.maxTokens - this.budget.reserveTokens,
    };
    this.tierUsage = [];
    return this.usage;
  }

  updateTierUsage(tierUsage: TierUsage[]): void {
    this.tierUsage = tierUsage;
  }

  getTierUsage(): TierUsage[] {
    return [...this.tierUsage];
  }

  getTierBreakdown(): string {
    if (this.tierUsage.length === 0) return '';
    return this.tierUsage
      .map(t => `T${t.tier}: ${t.tokens.toLocaleString()}tk (${t.items} items)`)
      .join(' | ');
  }

  // Estimate tokens for text (rough approximation: 4 chars ≈ 1 token)
  estimateTokens(text: string): number {
    if (!text) return 0;
    // More accurate for code: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  }

  // Estimate tokens for messages array
  estimateMessages(messages: Array<{ role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }>): number {
    let total = 0;
    
    for (const msg of messages) {
      // Base tokens per message (role, formatting)
      total += 4;
      
      if (msg.content) {
        total += this.estimateTokens(msg.content);
      }
      
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += this.estimateTokens(JSON.stringify(tc));
        }
      }
      
      if (msg.tool_call_id) {
        total += this.estimateTokens(msg.tool_call_id);
      }
    }

    return total;
  }

  updateUsage(usage: Partial<TokenUsage>): void {
    this.usage = {
      ...this.usage,
      ...usage,
      total: (usage.system ?? this.usage.system) +
             (usage.messages ?? this.usage.messages) +
             (usage.tools ?? this.usage.tools) +
             (usage.workingMemory ?? this.usage.workingMemory),
    };

    this.usage.available = this.budget.maxTokens - this.budget.reserveTokens - this.usage.total;
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  getUsagePercentage(): number {
    const usable = this.budget.maxTokens - this.budget.reserveTokens;
    return this.usage.total / usable;
  }

  shouldWarn(): boolean {
    return this.getUsagePercentage() >= this.budget.warningThreshold;
  }

  shouldCompress(): boolean {
    return this.getUsagePercentage() >= this.budget.compressionThreshold;
  }

  willFit(text: string): boolean {
    const needed = this.estimateTokens(text);
    return this.usage.available >= needed;
  }

  // Calculate what needs to be compressed
  getCompressionTarget(): { targetTokens: number; currentTokens: number } {
    const usable = this.budget.maxTokens - this.budget.reserveTokens;
    const targetTokens = Math.floor(usable * 0.7); // Compress to 70% to give breathing room
    return {
      targetTokens,
      currentTokens: this.usage.total,
    };
  }

  // Suggest which messages to compress (oldest first, excluding system)
  suggestMessagesToCompress(messages: Array<{ role: string; content?: string }>, targetReduction: number): number {
    let tokensToCompress = 0;
    let count = 0;

    // Start from oldest (skip system message at index 0)
    for (let i = 1; i < messages.length && tokensToCompress < targetReduction; i++) {
      const msg = messages[i];
      const tokens = this.estimateTokens(msg.content || '');
      
      // Don't compress tool results or user messages if possible
      if (msg.role === 'tool' || msg.role === 'user') {
        continue;
      }

      tokensToCompress += tokens;
      count++;
    }

    this.logger.debug(`Suggested compressing ${count} messages (${tokensToCompress} tokens)`);
    return count;
  }

  formatStatus(): string {
    const percentage = (this.getUsagePercentage() * 100).toFixed(1);
    const used = this.usage.total.toLocaleString();
    const max = (this.budget.maxTokens - this.budget.reserveTokens).toLocaleString();

    let color = 'green';
    if (this.shouldCompress()) color = 'red';
    else if (this.shouldWarn()) color = 'yellow';

    return `[${color}]${used}/${max} (${percentage}%)[/]`;
  }

  // Validation for incoming context
  validateContextSize(messages: any[]): { valid: boolean; reason?: string } {
    const estimated = this.estimateMessages(messages);
    const usable = this.budget.maxTokens - this.budget.reserveTokens;

    if (estimated > this.budget.maxTokens) {
      return {
        valid: false,
        reason: `Context too large: ~${estimated} tokens exceeds maximum ${this.budget.maxTokens}`,
      };
    }

    if (estimated > usable) {
      return {
        valid: false,
        reason: `Context nearly full: ~${estimated} tokens leaves no room for response`,
      };
    }

    return { valid: true };
  }

  // Log current usage
  logUsage(): void {
    this.logger.info('Token usage:', {
      system: this.usage.system,
      messages: this.usage.messages,
      tools: this.usage.tools,
      workingMemory: this.usage.workingMemory,
      total: this.usage.total,
      available: this.usage.available,
      percentage: (this.getUsagePercentage() * 100).toFixed(1) + '%',
      tiers: this.getTierBreakdown(),
    });
  }
}

// Global instance
let globalTokenManager: TokenManager | null = null;

export function getTokenManager(budget?: Partial<TokenBudget>, logger?: Logger): TokenManager {
  if (!globalTokenManager) {
    globalTokenManager = new TokenManager(budget, logger);
  }
  return globalTokenManager;
}
