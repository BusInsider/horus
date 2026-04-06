import { promises as fs, statSync } from 'fs';
import { join, relative, isAbsolute } from 'path';
import { Tool, ToolContext, ToolResult } from './types.js';

export const viewTool: Tool = {
  name: 'view',
  description: `View the contents of a file or directory. 
For files: Returns the file content with line numbers.
For directories: Returns a tree listing of files and subdirectories.
Respects .gitignore patterns.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file or directory to view',
      },
      viewRange: {
        type: 'array',
        description: 'Optional line range [start, end] to view only specific lines',
        items: { type: 'number' },
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ['path'],
  },

  async execute(args: { path: string; viewRange?: [number, number] }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);

    try {
      const stats = await fs.stat(targetPath);

      if (stats.isDirectory()) {
        return viewDirectory(targetPath, context.cwd);
      } else {
        return viewFile(targetPath, args.viewRange);
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

async function viewDirectory(targetPath: string, cwd: string): Promise<ToolResult> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    
    // Separate directories and files
    const dirs: string[] = [];
    const files: Array<{ name: string; size: string }> = [];

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.name.startsWith('.') || shouldIgnore(entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        dirs.push(entry.name + '/');
      } else {
        try {
          const fullPath = join(targetPath, entry.name);
          const stats = statSync(fullPath);
          files.push({
            name: entry.name,
            size: formatSize(stats.size),
          });
        } catch {
          files.push({ name: entry.name, size: '?' });
        }
      }
    }

    // Sort alphabetically
    dirs.sort();
    files.sort((a, b) => a.name.localeCompare(b.name));

    // Build output
    const lines: string[] = [];
    const relPath = relative(cwd, targetPath) || '.';
    lines.push(`${relPath}/`);
    
    for (const dir of dirs) {
      lines.push(`  ${dir}`);
    }
    
    for (const file of files) {
      lines.push(`  ${file.name} (${file.size})`);
    }

    lines.push('');
    lines.push(`${dirs.length} directories, ${files.length} files`);

    return {
      ok: true,
      content: lines.join('\n'),
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function viewFile(targetPath: string, viewRange?: [number, number]): Promise<ToolResult> {
  try {
    const content = await fs.readFile(targetPath, 'utf-8');
    const lines = content.split('\n');

    // If range specified, slice it
    let displayLines = lines;
    let startLine = 1;
    
    if (viewRange) {
      const [start, end] = viewRange;
      startLine = Math.max(1, start);
      const endLine = Math.min(lines.length, end);
      displayLines = lines.slice(startLine - 1, endLine);
    }

    // Add line numbers
    const numbered = displayLines.map((line, idx) => {
      const lineNum = startLine + idx;
      return `${lineNum.toString().padStart(4)} | ${line}`;
    });

    // Add header
    const header = `File: ${targetPath} (${lines.length} lines)`;
    if (viewRange) {
      const [start, end] = viewRange;
      const actualEnd = Math.min(lines.length, end);
      numbered.unshift(`${header} [lines ${start}-${actualEnd}]`);
    } else {
      numbered.unshift(header);
    }

    // Add truncation notice for large files
    if (lines.length > 200 && !viewRange) {
      numbered.push('');
      numbered.push('... (file truncated, use viewRange to see specific lines)');
      return {
        ok: true,
        content: numbered.slice(0, 202).join('\n'),
        annotations: { truncated: true, totalLines: lines.length },
      };
    }

    return {
      ok: true,
      content: numbered.join('\n'),
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function shouldIgnore(name: string): boolean {
  const ignorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '__pycache__',
    '*.pyc',
  ];
  return ignorePatterns.some(pattern => name.includes(pattern));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
