// Context Compaction Pipeline — 5-tier progressive compression for 256K context
// Builds the API prompt by progressively summarizing less-relevant context layers

import { promises as fs } from 'fs';
import { join } from 'path';
import type { Message as ApiMessage } from './kimi.js';
import type { Message as DbMessage } from './memory/schema.js';
import type { RecalledMemory, MemoryManager } from './memory/manager.js';
import { TokenManager } from './token-manager.js';
import {
  summarizeMessages,
  trimToolResult,
} from './utils/message-summarizer.js';
import { ContextLoader, estimateProjectSize } from './context-loader.js';

// ─── Configuration ───

export interface TierBudget {
  tier: 1 | 2 | 3 | 4 | 5;
  maxTokens: number;
  strategy: 'full' | 'trim' | 'summarize' | 'semantic' | 'retrieve';
}

export interface TierUsage {
  tier: number;
  tokens: number;
  items: number;
}

export interface BuildContextOptions {
  systemPrompt: string;
  messages: DbMessage[];
  memories: RecalledMemory[];
  task: string;
  memory: MemoryManager;
  tokenManager: TokenManager;
  cwd: string;
  enabled?: boolean;
}

// Default budgets for 256K context with 32K reserve
const DEFAULT_TIER_BUDGETS: TierBudget[] = [
  { tier: 1, maxTokens: 8000, strategy: 'full' },      // Working memory
  { tier: 2, maxTokens: 48000, strategy: 'trim' },     // Recent history
  { tier: 3, maxTokens: 64000, strategy: 'summarize' }, // Deep history
  { tier: 4, maxTokens: 100000, strategy: 'semantic' }, // Codebase context
  { tier: 5, maxTokens: 36000, strategy: 'retrieve' },  // External knowledge
];

// Aggressive budgets for K2.6 — leverages better long-context utilization
// 256K context with 16K reserve, shifted toward codebase context and deep history
export const K2_6_TIER_BUDGETS: TierBudget[] = [
  { tier: 1, maxTokens: 8000, strategy: 'full' },      // Working memory (unchanged)
  { tier: 2, maxTokens: 48000, strategy: 'trim' },     // Recent history (unchanged)
  { tier: 3, maxTokens: 80000, strategy: 'summarize' }, // Deep history: +16K
  { tier: 4, maxTokens: 140000, strategy: 'semantic' }, // Codebase context: +40K
  { tier: 5, maxTokens: 40000, strategy: 'retrieve' },  // External knowledge: +4K
];

// ─── Token estimation helpers ───

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateApiMessages(messages: ApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // base per message
    if (msg.content) total += estimateTokens(msg.content);
    if (msg.reasoning_content) total += estimateTokens(msg.reasoning_content);
    if (msg.tool_calls) total += estimateTokens(JSON.stringify(msg.tool_calls));
    if (msg.tool_call_id) total += estimateTokens(msg.tool_call_id);
  }
  return total;
}

// ─── ContextCompactor ───

export class ContextCompactor {
  private budgets: TierBudget[];
  private enabled: boolean;

  constructor(options?: { budgets?: TierBudget[]; enabled?: boolean }) {
    this.budgets = options?.budgets || DEFAULT_TIER_BUDGETS;
    this.enabled = options?.enabled ?? true;
  }

  /**
   * Build the full context with 5-tier progressive compaction.
   * Returns API-ready messages and per-tier usage stats.
   */
  async buildContext(options: BuildContextOptions): Promise<{
    messages: ApiMessage[];
    tierUsage: TierUsage[];
    totalTokens: number;
  }> {
    if (!this.enabled) {
      return this.buildFallbackContext(options);
    }

    const tierUsage: TierUsage[] = [];
    let remainingBudgets = [...this.budgets];

    // Build all tiers first (so we can measure them)
    const t1Budget = remainingBudgets.find(b => b.tier === 1)!;
    const t1Messages = this.buildTier1(options, t1Budget);
    const t1Tokens = estimateApiMessages(t1Messages);
    tierUsage.push({ tier: 1, tokens: t1Tokens, items: t1Messages.length });

    const t2Budget = remainingBudgets.find(b => b.tier === 2)!;
    const t2Messages = this.buildTier2(options, t2Budget);
    const t2Tokens = estimateApiMessages(t2Messages);
    tierUsage.push({ tier: 2, tokens: t2Tokens, items: t2Messages.length });

    const t3Budget = remainingBudgets.find(b => b.tier === 3)!;
    const t3Messages = this.buildTier3(options, t3Budget);
    const t3Tokens = estimateApiMessages(t3Messages);
    tierUsage.push({ tier: 3, tokens: t3Tokens, items: t3Messages.length });

    const t5Budget = remainingBudgets.find(b => b.tier === 5)!;
    const t5Messages = this.buildTier5(options, t5Budget);
    const t5Tokens = estimateApiMessages(t5Messages);
    tierUsage.push({ tier: 5, tokens: t5Tokens, items: t5Messages.length });

    const t4Budget = remainingBudgets.find(b => b.tier === 4)!;
    const t4Available = t4Budget.maxTokens + Math.max(0, t5Budget.maxTokens - t5Tokens);
    const t4Messages = await this.buildTier4(options, { ...t4Budget, maxTokens: t4Available });
    const t4Tokens = estimateApiMessages(t4Messages);
    tierUsage.push({ tier: 4, tokens: t4Tokens, items: t4Messages.length });

    // Assemble in CHRONOLOGICAL order:
    // 1. System messages (T4, T5, T3, system prompt) first
    // 2. T2 recent history (older conversation)
    // 3. T1 working memory (most recent conversation)
    const resultMessages: ApiMessage[] = [];

    // Collect all system content
    const systemParts: string[] = [];
    systemParts.push(options.systemPrompt);
    for (const m of t4Messages) if (m.role === 'system' && m.content) systemParts.push(m.content);
    for (const m of t5Messages) if (m.role === 'system' && m.content) systemParts.push(m.content);
    for (const m of t3Messages) if (m.role === 'system' && m.content) systemParts.push(m.content);

    // Single system message with all context
    const combinedSystem = systemParts.join('\n\n');
    if (combinedSystem) {
      resultMessages.push({ role: 'system', content: combinedSystem });
    }

    // Conversation messages in chronological order: T2 (older) then T1 (newer)
    resultMessages.push(...t2Messages);
    resultMessages.push(...t1Messages.filter(m => m.role !== 'system'));

    const totalTokens = estimateApiMessages(resultMessages);

    return { messages: resultMessages, tierUsage, totalTokens };
  }

  // ─── Tier Builders ───

  /**
   * T1: Working Memory — system prompt + most recent user + assistant + tool results.
   * Never compressed. Always at full fidelity.
   */
  private buildTier1(options: BuildContextOptions, budget: TierBudget): ApiMessage[] {
    const messages: ApiMessage[] = [];
    const nonSystem = options.messages.filter(m => m.role !== 'system');

    // Find the most recent "turn" (user message + assistant response + tool results)
    // A turn ends at the next user message or the end
    const lastUserIndex = findLastIndex(nonSystem, m => m.role === 'user');
    if (lastUserIndex === -1) return messages;

    const currentTurn = nonSystem.slice(lastUserIndex);
    for (const msg of currentTurn) {
      messages.push(dbToApi(msg));
    }

    // Also include the previous turn if T1 has room (helps continuity)
    const t1Tokens = estimateApiMessages(messages);
    if (t1Tokens < budget.maxTokens * 0.8) {
      const prevUserIndex = findLastIndex(nonSystem.slice(0, lastUserIndex), m => m.role === 'user');
      if (prevUserIndex !== -1) {
        const prevTurn = nonSystem.slice(prevUserIndex, lastUserIndex);
        const prevTokens = estimateApiMessages(prevTurn.map(dbToApi));
        if (t1Tokens + prevTokens < budget.maxTokens) {
          messages.unshift(...prevTurn.map(dbToApi));
        }
      }
    }

    return messages;
  }

  /**
   * T2: Recent History — last 10-12 turns before T1, with trimmed tool results.
   */
  private buildTier2(options: BuildContextOptions, budget: TierBudget): ApiMessage[] {
    const nonSystem = options.messages.filter(m => m.role !== 'system');
    const messages: ApiMessage[] = [];

    // Find where T1 ends
    const lastUserIndex = findLastIndex(nonSystem, m => m.role === 'user');
    if (lastUserIndex === -1) return messages;

    // Also account for previous turn included in T1
    const prevUserIndex = findLastIndex(nonSystem.slice(0, lastUserIndex), m => m.role === 'user');
    const t1Cutoff = prevUserIndex !== -1 ? prevUserIndex : lastUserIndex;

    // Take messages before T1, up to ~10-12 turns
    const recentHistory = nonSystem.slice(0, t1Cutoff);

    // Count turns from the end
    let turnCount = 0;
    let cutoffIndex = recentHistory.length;
    for (let i = recentHistory.length - 1; i >= 0; i--) {
      if (recentHistory[i].role === 'user') turnCount++;
      if (turnCount > 12) {
        cutoffIndex = i;
        break;
      }
    }

    const t2Messages = recentHistory.slice(cutoffIndex);
    let currentTokens = 0;

    for (const msg of t2Messages) {
      let apiMsg = dbToApi(msg);

      // Trim tool results
      if (apiMsg.role === 'tool' && apiMsg.content && estimateTokens(apiMsg.content) > 512) {
        apiMsg = {
          ...apiMsg,
          content: trimToolResult(apiMsg.content, 512),
        };
      }

      // Trim reasoning content
      if (apiMsg.reasoning_content && estimateTokens(apiMsg.reasoning_content) > 256) {
        apiMsg = {
          ...apiMsg,
          reasoning_content: apiMsg.reasoning_content.slice(0, 256 * 4) + '\n[...reasoning truncated...]',
        };
      }

      const msgTokens = estimateApiMessages([apiMsg]);
      if (currentTokens + msgTokens > budget.maxTokens) {
        break;
      }

      messages.push(apiMsg);
      currentTokens += msgTokens;
    }

    return messages;
  }

  /**
   * T3: Deep History — summarize everything before T2 into key facts.
   */
  private buildTier3(options: BuildContextOptions, budget: TierBudget): ApiMessage[] {
    const nonSystem = options.messages.filter(m => m.role !== 'system');

    // Find T2 cutoff
    const lastUserIndex = findLastIndex(nonSystem, m => m.role === 'user');
    if (lastUserIndex === -1) return [];

    const prevUserIndex = findLastIndex(nonSystem.slice(0, lastUserIndex), m => m.role === 'user');
    const t1Cutoff = prevUserIndex !== -1 ? prevUserIndex : lastUserIndex;

    let turnCount = 0;
    let t2Cutoff = 0;
    for (let i = t1Cutoff - 1; i >= 0; i--) {
      if (nonSystem[i].role === 'user') turnCount++;
      if (turnCount > 12) {
        t2Cutoff = i;
        break;
      }
    }

    const deepHistory = nonSystem.slice(0, t2Cutoff);
    if (deepHistory.length === 0) return [];

    // Summarize in batches to control summary size
    const summary = summarizeMessages(deepHistory);

    if (estimateTokens(summary) > budget.maxTokens) {
      // Truncate summary if too large
      const truncated = summary.slice(0, budget.maxTokens * 4 - 50) + '\n[...summary truncated...]';
      return [{ role: 'system', content: truncated }];
    }

    return [{ role: 'system', content: summary }];
  }

  /**
   * T4: Codebase Context — load relevant files via semantic search, not wholesale.
   */
  private async buildTier4(
    options: BuildContextOptions,
    budget: TierBudget
  ): Promise<ApiMessage[]> {
    try {
      // Check if project is tiny — if so, use wholesale loading
      const projectEstimate = await estimateProjectSize(options.cwd);
      if (projectEstimate.fitsInContext && projectEstimate.fileCount < 50 && projectEstimate.estimatedTokens < 20000) {
        return await this.loadWholesaleCodebase(options, budget);
      }

      // Semantic loading for larger projects
      return await this.loadSemanticCodebase(options, budget);
    } catch {
      // If codebase loading fails (e.g., permission denied), return empty
      return [];
    }
  }

  private async loadWholesaleCodebase(
    options: BuildContextOptions,
    budget: TierBudget
  ): Promise<ApiMessage[]> {
    const loader = new ContextLoader({ rootPath: options.cwd, maxTokens: budget.maxTokens });
    const { files, totalTokens, truncated } = await loader.loadContext();
    if (files.length === 0) return [];

    const codebaseContext = loader.formatForContext(files);
    const content = `# Codebase Context\n\nLoaded ${files.length} files${truncated ? ' (truncated)' : ''}, ~${Math.round(totalTokens / 1000)}K tokens\n\n${codebaseContext}`;

    return [{ role: 'system', content }];
  }

  private async loadSemanticCodebase(
    options: BuildContextOptions,
    budget: TierBudget
  ): Promise<ApiMessage[]> {
    const parts: string[] = [];
    parts.push('# Codebase Context (relevant files)');

    // Get relevant files via memory recall
    const recalled = await options.memory.recall(options.task, 50);
    const fileMemories = recalled.filter(m => m.type === 'code' || m.type === 'file');

    if (fileMemories.length === 0) {
      return [];
    }

    let usedTokens = estimateTokens(parts.join('\n'));
    const fullFiles: Array<{ path: string; content: string }> = [];
    const outlines: Array<{ path: string; outline?: string; summary?: string }> = [];
    const paths: string[] = [];

    // Tier the files by relevance
    for (let i = 0; i < fileMemories.length; i++) {
      const mem = fileMemories[i];
      const path = mem.source || mem.metadata?.path;
      if (!path) continue;

      if (i < 10) {
        // Top 10: try to load full content
        try {
          const content = await fs.readFile(join(options.cwd, path), 'utf-8');
          const estimated = Math.ceil(content.length / 4);
          if (usedTokens + estimated < budget.maxTokens * 0.7) {
            fullFiles.push({ path, content });
            usedTokens += estimated;
          } else {
            outlines.push({ path, outline: mem.metadata?.outline, summary: mem.metadata?.summary });
          }
        } catch {
          outlines.push({ path, outline: mem.metadata?.outline, summary: mem.metadata?.summary });
        }
      } else if (i < 40) {
        // Next 30: outline/summary only
        outlines.push({ path, outline: mem.metadata?.outline, summary: mem.metadata?.summary });
      } else {
        // Rest: just path
        paths.push(path);
      }
    }

    // Build output
    for (const f of fullFiles) {
      parts.push(`\n## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``);
    }

    if (outlines.length > 0) {
      parts.push('\n## File Outlines');
      for (const o of outlines) {
        const info = o.summary || o.outline || '';
        parts.push(`- ${o.path}${info ? ': ' + info.split('\n')[0] : ''}`);
      }
    }

    if (paths.length > 0) {
      parts.push(`\n## Other Relevant Files (${paths.length})`);
      for (const p of paths.slice(0, 20)) {
        parts.push(`- ${p}`);
      }
      if (paths.length > 20) {
        parts.push(`- ... and ${paths.length - 20} more`);
      }
    }

    const content = parts.join('\n');
    if (estimateTokens(content) > budget.maxTokens) {
      const truncated = content.slice(0, budget.maxTokens * 4 - 50) + '\n[...truncated...]';
      return [{ role: 'system', content: truncated }];
    }

    return [{ role: 'system', content }];
  }

  /**
   * T5: External Knowledge — memories, facts, episodes from recall.
   */
  private buildTier5(options: BuildContextOptions, budget: TierBudget): ApiMessage[] {
    if (options.memories.length === 0) return [];

    const lines: string[] = [];
    lines.push('=== RELEVANT KNOWLEDGE ===');

    const facts = options.memories.filter(m => m.type === 'fact');
    const episodes = options.memories.filter(m => m.type === 'episode');
    const code = options.memories.filter(m => m.type === 'code' || m.type === 'file');

    if (facts.length > 0) {
      lines.push('\nFacts:');
      for (const f of facts.slice(0, 5)) {
        lines.push(`  • ${truncateLine(f.content, 150)}`);
      }
    }

    if (episodes.length > 0) {
      lines.push('\nPast actions:');
      for (const ep of episodes.slice(0, 5)) {
        const date = ep.timestamp ? new Date(ep.timestamp).toLocaleDateString() : 'unknown';
        lines.push(`  • [${date}] ${truncateLine(ep.content.split('\n')[0], 150)}`);
      }
    }

    if (code.length > 0) {
      lines.push('\nRelevant code:');
      for (const c of code.slice(0, 3)) {
        lines.push(`  • ${c.source || 'unknown'}: ${truncateLine(c.content.split('\n')[0], 120)}`);
      }
    }

    lines.push('=== END KNOWLEDGE ===');
    const content = lines.join('\n');

    if (estimateTokens(content) > budget.maxTokens) {
      const truncated = content.slice(0, budget.maxTokens * 4 - 50) + '\n[...truncated...]';
      return [{ role: 'system', content: truncated }];
    }

    return [{ role: 'system', content }];
  }

  // ─── Fallback (old behavior) ───

  private async buildFallbackContext(options: BuildContextOptions): Promise<{
    messages: ApiMessage[];
    tierUsage: TierUsage[];
    totalTokens: number;
  }> {
    const messages: ApiMessage[] = [];
    let systemPrompt = options.systemPrompt;

    // Old behavior: load full codebase if small
    const projectEstimate = await estimateProjectSize(options.cwd);
    if (projectEstimate.fitsInContext && projectEstimate.fileCount > 0) {
      const loader = new ContextLoader({ rootPath: options.cwd });
      const { files } = await loader.loadContext();
      if (files.length > 0) {
        systemPrompt += '\n\n' + loader.formatForContext(files);
      }
    }

    if (options.memories.length > 0) {
      systemPrompt += '\n\n' + this.formatMemoriesFallback(options.memories);
    }

    messages.push({ role: 'system', content: systemPrompt });

    for (const msg of options.messages.slice(1)) {
      messages.push(dbToApi(msg));
    }

    const totalTokens = estimateApiMessages(messages);
    return {
      messages,
      tierUsage: [{ tier: 0, tokens: totalTokens, items: messages.length }],
      totalTokens,
    };
  }

  private formatMemoriesFallback(memories: RecalledMemory[]): string {
    const lines: string[] = [];
    lines.push('=== RELEVANT MEMORIES ===');

    const facts = memories.filter(m => m.type === 'fact');
    const episodes = memories.filter(m => m.type === 'episode');
    const code = memories.filter(m => m.type === 'code' || m.type === 'file');

    if (facts.length > 0) {
      lines.push('\nKnown Facts:');
      for (const f of facts.slice(0, 5)) lines.push(`- ${f.content}`);
    }
    if (episodes.length > 0) {
      lines.push('\nPast Actions:');
      for (const ep of episodes.slice(0, 5)) {
        const date = ep.timestamp ? new Date(ep.timestamp).toLocaleDateString() : 'unknown';
        lines.push(`- [${date}] ${ep.content.split('\n')[0]}`);
      }
    }
    if (code.length > 0) {
      lines.push('\nRelevant Code:');
      for (const c of code.slice(0, 3)) lines.push(`- ${c.source || 'unknown'}`);
    }

    lines.push('=== END MEMORIES ===');
    return lines.join('\n');
  }
}

// ─── Helpers ───

function dbToApi(msg: DbMessage): ApiMessage {
  return {
    role: msg.role,
    content: msg.content,
    reasoning_content: msg.reasoningContent,
    tool_calls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
    tool_call_id: msg.toolCallId,
  };
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

function truncateLine(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
