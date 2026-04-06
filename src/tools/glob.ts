import { Tool, ToolContext, ToolResult } from './types.js';

export const globTool: Tool = {
  name: 'glob',
  description: `Find files matching a glob pattern.
Useful for discovering files in the project.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "src/**/*.ts", "*.json")',
      },
      path: {
        type: 'string',
        description: 'Base directory (default: cwd)',
      },
    },
    required: ['pattern'],
  },

  async execute(args: { pattern: string; path?: string }, context: ToolContext): Promise<ToolResult> {
    try {
      const glob = await import('fast-glob');
      
      const entries = await glob.default(args.pattern, {
        cwd: args.path || context.cwd,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      });

      if (entries.length === 0) {
        return {
          ok: true,
          content: `No files found matching "${args.pattern}"`,
        };
      }

      // Get file stats
      const { promises: fs } = await import('fs');
      const files: Array<{ path: string; size: string }> = [];

      for (const entry of entries.slice(0, 100)) { // Limit to 100 files
        try {
          const stats = await fs.stat(entry);
          files.push({
            path: entry,
            size: formatSize(stats.size),
          });
        } catch {
          files.push({ path: entry, size: '?' });
        }
      }

      const lines = files.map(f => `${f.path} (${f.size})`);
      
      if (entries.length > 100) {
        lines.push(`\n... and ${entries.length - 100} more files`);
      }

      lines.push(`\nTotal: ${entries.length} files`);

      return {
        ok: true,
        content: lines.join('\n'),
        annotations: {
          fileCount: entries.length,
          pattern: args.pattern,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Glob failed',
      };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
