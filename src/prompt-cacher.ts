// System Prompt Caching - Optimize API costs through cache-efficient prompt design
// Based on Claude Code's system prompt architecture

// ============================================================================
// TYPES
// ============================================================================

export type PromptSectionType = 'static' | 'memoized' | 'volatile';

export interface PromptSection {
  content: string;
  type: PromptSectionType;
  priority: number; // Higher = earlier in prompt
}

export interface CachedPrompt {
  static: string;
  dynamic: string;
  full: string;
  cacheHitRate: number; // Estimated
}

// ============================================================================
// SYSTEM PROMPT CACHE MANAGER
// ============================================================================

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '<!-- DYNAMIC_CONTENT_BELOW -->';

export class PromptCacheManager {
  private staticSections: PromptSection[] = [];
  private memoizedSections: Map<string, string> = new Map();
  private volatileCompute: (() => string) | null = null;
  
  // Add a static section (cached globally across all sessions)
  addStaticSection(content: string, priority: number = 0): void {
    this.staticSections.push({ content, type: 'static', priority });
    // Sort by priority (higher first)
    this.staticSections.sort((a, b) => b.priority - a.priority);
  }
  
  // Add a memoized section (computed once per session, cached)
  setMemoizedSection(key: string, content: string): void {
    this.memoizedSections.set(key, content);
  }
  
  // Set volatile section (computed every turn)
  setVolatileComputer(compute: () => string): void {
    this.volatileCompute = compute;
  }
  
  // Build the full system prompt with boundary marker
  buildPrompt(): CachedPrompt {
    // Static sections (cached globally)
    const staticContent = this.staticSections
      .map(s => s.content)
      .join('\n\n');
    
    // Memoized sections (cached per session)
    const memoizedContent = Array.from(this.memoizedSections.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, content]) => content)
      .join('\n\n');
    
    // Volatile sections (computed every turn)
    const volatileContent = this.volatileCompute ? this.volatileCompute() : '';
    
    // Build full prompt with boundary
    const parts: string[] = [];
    
    if (staticContent) {
      parts.push(staticContent);
    }
    
    if (memoizedContent) {
      parts.push(memoizedSection(memoizedContent));
    }
    
    if (volatileContent) {
      parts.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
      parts.push(volatileContent);
    }
    
    const full = parts.join('\n\n');
    
    // Calculate estimated cache hit rate
    const staticTokens = estimateTokens(staticContent);
    const totalTokens = estimateTokens(full);
    const cacheHitRate = totalTokens > 0 ? staticTokens / totalTokens : 0;
    
    return {
      static: staticContent,
      dynamic: memoizedContent + '\n\n' + volatileContent,
      full,
      cacheHitRate,
    };
  }
  
  // Build just the static portion (for cache key)
  buildStaticKey(): string {
    return this.staticSections
      .map(s => s.content)
      .join('\n\n');
  }
}

// ============================================================================
// CONTEXT INJECTION (IN USER MESSAGE)
// ============================================================================

/**
 * Build context reminder that goes in the FIRST user message, not system prompt.
 * This keeps the system prompt cache-stable while allowing dynamic context.
 */
export function buildContextReminder(context: {
  cwd: string;
  date: string;
  gitBranch?: string;
  recentFiles?: string[];
  claudeMdContent?: string;
}): string {
  const parts: string[] = [];
  
  parts.push('<system-reminder>');
  parts.push('As you answer the user\'s questions, you can use the following context:');
  parts.push('');
  
  // Current date
  parts.push(`# currentDate`);
  parts.push(`Today's date is ${context.date}.`);
  parts.push('');
  
  // Working directory
  parts.push(`# workingDirectory`);
  parts.push(`Current working directory: ${context.cwd}`);
  if (context.gitBranch) {
    parts.push(`Git branch: ${context.gitBranch}`);
  }
  parts.push('');
  
  // Recent files
  if (context.recentFiles && context.recentFiles.length > 0) {
    parts.push(`# recentFiles`);
    parts.push('Recently accessed files:');
    for (const file of context.recentFiles.slice(0, 10)) {
      parts.push(`  - ${file}`);
    }
    parts.push('');
  }
  
  // CLAUDE.md content
  if (context.claudeMdContent) {
    parts.push(`# claudeMd`);
    parts.push(context.claudeMdContent);
    parts.push('');
  }
  
  parts.push('</system-reminder>');
  
  return parts.join('\n');
}

// ============================================================================
// HORUS SYSTEM PROMPT BUILDER
// ============================================================================

export function buildHorusSystemPrompt(config: {
  mode: 'auto' | 'semi' | 'review';
  showMemoryOperations: boolean;
  memoryEnabled: boolean;
}): CachedPrompt {
  const manager = new PromptCacheManager();
  
  // === STATIC SECTION (cached globally) ===
  // This never changes across all sessions
  
  manager.addStaticSection(`
You are Horus, an autonomous coding agent running in a terminal environment.
You help users write, refactor, debug, and understand code.

Core principles:
- Be concise but thorough
- Show your reasoning when making changes
- Always verify file operations succeeded
- Respect user preferences from configuration
  `.trim(), 100);
  
  manager.addStaticSection(`
Available tools:
- view: Read file contents
- edit: Make precise text edits
- create: Create new files
- search: Search with ripgrep
- glob: Find files by pattern
- bash: Execute shell commands
- recall: Search memory
- remember: Store facts

Tool calling format:
<tool_name>{"arg1": "value1", "arg2": "value2"}</tool_name>
  `.trim(), 90);
  
  if (config.memoryEnabled) {
    manager.addStaticSection(`
Memory system:
- recall(query) - Search across past conversations
- remember(content, type) - Store important facts
- Your memory persists across sessions
- Use recall proactively when context seems relevant
    `.trim(), 80);
  }
  
  // === MEMOIZED SECTION (cached per session) ===
  // This changes per session but is stable within a session
  
  manager.setMemoizedSection('mode', `
Mode: ${config.mode}
${config.mode === 'auto' ? 'Execute tools without confirmation unless destructive.' : ''}
${config.mode === 'semi' ? 'Ask before destructive operations (file deletion, broad changes).' : ''}
${config.mode === 'review' ? 'Stop after each step for user approval.' : ''}
  `.trim());
  
  // === VOLATILE SECTION (computed every turn) ===
  // This changes every turn, goes after the boundary
  
  // Actually, we DON'T put volatile content in system prompt at all!
  // Instead, we put it in the user message via buildContextReminder()
  // This keeps system prompt completely cache-stable
  
  return manager.buildPrompt();
}

// ============================================================================
// HELPERS
// ============================================================================

function memoizedSection(content: string): string {
  return `<!-- MEMOIZED_SESSION_CONTEXT -->\n${content}`;
}

function estimateTokens(text: string): number {
  // Rough estimate: 4 characters per token
  return Math.ceil(text.length / 4);
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/**
 * Example: Building prompts for a session
 * 
 * // 1. Build system prompt (cached)
 * const systemPrompt = buildHorusSystemPrompt({
 *   mode: 'semi',
 *   memoryEnabled: true,
 * });
 * 
 * // 2. Build context reminder (changes every turn, goes in user message)
 * const contextReminder = buildContextReminder({
 *   cwd: '/home/user/project',
 *   date: new Date().toISOString().split('T')[0],
 *   gitBranch: 'main',
 *   recentFiles: ['src/index.ts', 'src/config.ts'],
 * });
 * 
 * // 3. First user message includes context
 * const messages = [
 *   { role: 'system', content: systemPrompt.full },
 *   { role: 'user', content: contextReminder + '\n\nActually user query here...' },
 * ];
 * 
 * // Result: System prompt is cache-stable, context changes in user message
 */
