import { spawn } from 'child_process';
import { join, isAbsolute } from 'path';
import { Tool, ToolContext, ToolResult } from './types.js';

export const searchTool: Tool = {
  name: 'search',
  description: `Search for text patterns in code files using ripgrep.
Fast and respects .gitignore by default.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search pattern (ripgrep regex)',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (default: cwd)',
      },
      glob: {
        type: 'string',
        description: 'File glob pattern (e.g., "*.ts", "*.js")',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
        default: false,
      },
    },
    required: ['query'],
  },

  async execute(args: { query: string; path?: string; glob?: string; caseSensitive?: boolean }, context: ToolContext): Promise<ToolResult> {
    const targetPath = args.path ? (isAbsolute(args.path) ? args.path : join(context.cwd, args.path)) : context.cwd;

    try {
      const results = await runRipgrep({
        pattern: args.query,
        path: targetPath,
        glob: args.glob,
        caseSensitive: args.caseSensitive,
      });

      if (results.length === 0) {
        return {
          ok: true,
          content: `No matches found for "${args.query}"`,
        };
      }

      const formatted = formatResults(results);
      return {
        ok: true,
        content: formatted,
        annotations: {
          matchCount: results.length,
          query: args.query,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  },
};

interface RipgrepResult {
  path: string;
  line: number;
  column: number;
  match: string;
  context: string[];
}

async function runRipgrep(options: {
  pattern: string;
  path: string;
  glob?: string;
  caseSensitive?: boolean;
}): Promise<RipgrepResult[]> {
  const args = [
    '--column',
    '--line-number',
    '--no-heading',
    '--color=never',
    '--max-count=25',
    '--context=2',
    '--hidden',
  ];

  if (!options.caseSensitive) {
    args.push('--ignore-case');
  }

  if (options.glob) {
    args.push('--glob', options.glob);
  }

  // Add ignore patterns
  args.push('--glob', '!node_modules/**');
  args.push('--glob', '!.git/**');
  args.push('--glob', '!dist/**');
  args.push('--glob', '!build/**');

  args.push(options.pattern);
  args.push(options.path);

  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', () => {
      // ripgrep not installed
      reject(new Error('ripgrep (rg) not found. Please install it: https://github.com/BurntSushi/ripgrep#installation'));
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== 1) { // 1 means no matches found
        reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
        return;
      }

      const results = parseRipgrepOutput(stdout);
      resolve(results);
    });
  });
}

function parseRipgrepOutput(output: string): RipgrepResult[] {
  const results: RipgrepResult[] = [];
  const lines = output.split('\n');

  const contextLines: string[] = [];
  let currentMatch: Partial<RipgrepResult> | null = null;

  for (const line of lines) {
    // Match line format: path:line:column:content
    const matchRegex = /^(.+?):(\d+):(\d+):(.*)$/;
    const match = line.match(matchRegex);

    if (match) {
      // Save previous match if exists
      if (currentMatch) {
        results.push({
          path: currentMatch.path!,
          line: currentMatch.line!,
          column: currentMatch.column!,
          match: currentMatch.match!,
          context: [...contextLines],
        });
        contextLines.length = 0;
      }

      currentMatch = {
        path: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        match: match[4].trim(),
      };
    } else if (line.startsWith('-')) {
      // Context line (before)
      contextLines.push(line.substring(1));
    } else if (line) {
      // Could be context line or other
      contextLines.push(line);
    }
  }

  // Don't forget the last match
  if (currentMatch) {
    results.push({
      path: currentMatch.path!,
      line: currentMatch.line!,
      column: currentMatch.column!,
      match: currentMatch.match!,
      context: contextLines,
    });
  }

  return results;
}

function formatResults(results: RipgrepResult[]): string {
  const grouped = new Map<string, RipgrepResult[]>();

  for (const r of results) {
    if (!grouped.has(r.path)) {
      grouped.set(r.path, []);
    }
    grouped.get(r.path)!.push(r);
  }

  const lines: string[] = [];
  lines.push(`Found ${results.length} matches:\n`);

  for (const [path, matches] of grouped) {
    lines.push(`${path}:`);
    for (const m of matches) {
      lines.push(`  ${m.line}:${m.match}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
