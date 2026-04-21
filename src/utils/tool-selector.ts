// On-demand tool discovery — select relevant tools per turn instead of loading all ~20
// Research: >20 tools visible in system prompt degrades tool selection accuracy

import type { Tool } from '../tools/types.js';

export interface ToolSelectionConfig {
  maxTools: number;
  coreTools: string[];
  forceInclude?: string[];
}

interface ScoredTool {
  name: string;
  tool: Tool;
  score: number;
}

// Core tools that are almost always needed for coding tasks
const DEFAULT_CORE_TOOLS = ['view', 'edit', 'bash', 'search'];

// Keywords that strongly signal specific tools
const TOOL_KEYWORD_MAP: Record<string, string[]> = {
  // File operations
  view: ['view', 'read', 'show', 'look', 'inspect', 'see', 'display', 'content', 'file'],
  edit: ['edit', 'change', 'modify', 'update', 'fix', 'replace', 'rewrite', 'patch', 'create', 'new file'],
  cat: ['cat', 'concatenate', 'dump', 'raw'],
  ls: ['list', 'directory', 'folder', 'files', 'contents', 'ls', 'dir'],
  mkdir: ['mkdir', 'create directory', 'make directory', 'folder'],
  rm: ['remove', 'delete', 'rm', 'destroy', 'clean'],

  // Search
  search: ['search', 'find', 'grep', 'locate', 'where', 'look for', 'ripgrep'],
  glob: ['glob', 'pattern', 'wildcard', 'match files', '*.'],
  grep: ['grep', 'regex', 'pattern match', 'search text'],

  // Commands
  bash: ['run', 'execute', 'command', 'shell', 'bash', 'terminal', 'npm', 'node', 'python', 'git ', 'install', 'build', 'test', 'lint'],

  // Git
  git_status: ['git status', 'status', 'untracked', 'modified', 'staged'],
  git_diff: ['git diff', 'difference', 'changes', 'what changed', 'patch'],
  git_log: ['git log', 'history', 'commit', 'author', 'who wrote'],

  // Data
  fetch: ['fetch', 'url', 'http', 'download', 'web', 'api', 'request', 'curl', 'wget'],
  json_parse: ['json', 'parse', 'extract', 'object', 'schema'],
  json_format: ['format', 'prettify', 'indent', 'json'],
  math: ['math', 'calculate', 'compute', 'sum', 'average', 'formula', 'equation'],

  // Memory
  recall: ['recall', 'remember', 'memory', 'past', 'previous', 'history', 'what did', 'before'],
  remember: ['remember', 'store', 'save', 'memorize', 'note', 'fact', 'learn'],
  index: ['index', 'workspace', 'embed', 'semantic', 'codebase index'],

  // Skills
  skill_list: ['skill', 'list skills', 'what can you do', 'capabilities'],
  skill_create: ['create skill', 'new skill', 'make skill', 'define skill'],
  skill_view: ['view skill', 'show skill', 'skill detail'],
  skill_delete: ['delete skill', 'remove skill'],
  skill_evolve: ['evolve', 'improve skill', 'update skill'],
  skill_stats: ['skill stats', 'usage', 'metrics'],
};

export class ToolSelector {
  private config: ToolSelectionConfig;

  constructor(config?: Partial<ToolSelectionConfig>) {
    this.config = {
      maxTools: 15,
      coreTools: DEFAULT_CORE_TOOLS,
      ...config,
    };
  }

  /**
   * Select the most relevant tools for the current context.
   * Always includes core tools, then scores and ranks remaining tools.
   */
  select(tools: Map<string, Tool>, context: string, forceInclude?: string[]): Tool[] {
    const allTools = Array.from(tools.entries());
    const contextLower = context.toLowerCase();
    const forced = new Set(forceInclude || []);

    // Separate core tools from dynamic tools
    const core: ScoredTool[] = [];
    const dynamic: ScoredTool[] = [];

    for (const [name, tool] of allTools) {
      const score = this.scoreTool(name, tool, contextLower);
      if (this.config.coreTools.includes(name) || forced.has(name)) {
        core.push({ name, tool, score: score + 100 }); // Boost core/forced tools
      } else {
        dynamic.push({ name, tool, score });
      }
    }

    // Sort dynamic by score descending
    dynamic.sort((a, b) => b.score - a.score);

    // How many dynamic slots remain after core tools
    const dynamicSlots = Math.max(0, this.config.maxTools - core.length);
    const selectedDynamic = dynamic.slice(0, dynamicSlots);

    // Combine and return
    const selected = [...core, ...selectedDynamic];

    // If we have fewer than maxTools, add more dynamic tools even with low scores
    // (ensures diverse tool availability)
    if (selected.length < this.config.maxTools && dynamic.length > selectedDynamic.length) {
      const remaining = dynamic.slice(dynamicSlots);
      selected.push(...remaining.slice(0, this.config.maxTools - selected.length));
    }

    return selected.map(s => s.tool);
  }

  /**
   * Score a tool's relevance to the context using keyword matching.
   */
  private scoreTool(name: string, tool: Tool, contextLower: string): number {
    let score = 0;

    // Check keyword map
    const keywords = TOOL_KEYWORD_MAP[name] || [];
    for (const kw of keywords) {
      if (contextLower.includes(kw.toLowerCase())) {
        score += 2;
      }
    }

    // Check tool name match
    if (contextLower.includes(name.toLowerCase().replace(/[_-]/g, ' '))) {
      score += 3;
    }

    // Check description keywords
    const descLower = tool.description.toLowerCase();
    const descWords = descLower.split(/\s+/).filter(w => w.length > 3);
    for (const word of descWords) {
      if (contextLower.includes(word)) {
        score += 0.5;
      }
    }

    // Penalize highly specific tools in generic contexts
    if (score === 0 && this.isSpecializedTool(name)) {
      score -= 1;
    }

    return score;
  }

  private isSpecializedTool(name: string): boolean {
    const specialized = ['skill_evolve', 'skill_stats', 'skill_delete', 'json_format', 'math', 'cat', 'glob'];
    return specialized.includes(name);
  }

  /**
   * Get selection summary for debugging/telemetry.
   */
  getSelectionSummary(tools: Map<string, Tool>, context: string, forceInclude?: string[]): {
    selected: string[];
    dropped: string[];
    scores: Record<string, number>;
  } {
    const allNames = Array.from(tools.keys());
    const selected = this.select(tools, context, forceInclude);
    const selectedNames = selected.map(t => t.name);
    const dropped = allNames.filter(n => !selectedNames.includes(n));

    const scores: Record<string, number> = {};
    for (const name of allNames) {
      const tool = tools.get(name)!;
      scores[name] = this.scoreTool(name, tool, context.toLowerCase());
    }

    return { selected: selectedNames, dropped, scores };
  }
}

// Default instance
export const defaultToolSelector = new ToolSelector();
