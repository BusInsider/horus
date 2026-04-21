// Grep tool - Search file contents with regex
import { promises as fs } from 'fs';
import { join, isAbsolute } from 'path';
import { Tool, ToolContext, ToolResult } from './types.js';

export const grepTool: Tool = {
  name: 'grep',
  description: `Search file contents using regex patterns. 
Returns matching lines with file paths and line numbers.
Use this to find specific code patterns, function definitions, imports, etc.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for (e.g., "function\\s+\\w+", "import.*from")',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in',
      },
      filePattern: {
        type: 'string',
        description: 'Optional file pattern to filter (e.g., "*.ts", "*.js")',
      },
    },
    required: ['pattern', 'path'],
  },

  async execute(args: { pattern: string; path: string; filePattern?: string }, context: ToolContext): Promise<ToolResult> {
    // Security: Validate pattern to prevent ReDoS
    if (args.pattern.length > 1000) {
      return {
        ok: false,
        error: 'Pattern too long (max 1000 characters)',
      };
    }

    // Security: Validate filePattern
    if (args.filePattern && args.filePattern.length > 100) {
      return {
        ok: false,
        error: 'File pattern too long (max 100 characters)',
      };
    }

    // Determine target path
    const resolvedPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);
    
    // Allow paths outside cwd but validate for security
    // Block system directories that shouldn't be searched
    const blockedPaths = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/opt'];
    const normalizedPath = resolvedPath.toLowerCase();
    for (const blocked of blockedPaths) {
      if (normalizedPath.startsWith(blocked)) {
        return {
          ok: false,
          error: `Cannot search in system directory: ${blocked}`,
        };
      }
    }
    
    const targetPath = resolvedPath;

    try {
      const stats = await fs.stat(targetPath);
      
      if (stats.isFile()) {
        return searchFile(targetPath, args.pattern);
      } else {
        return searchDirectory(targetPath, args.pattern, args.filePattern);
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  },
};

async function searchFile(filePath: string, pattern: string): Promise<ToolResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const regex = new RegExp(pattern, 'i');
    
    const matches: string[] = [];
    lines.forEach((line, idx) => {
      if (regex.test(line)) {
        matches.push(`${idx + 1}: ${line.trim()}`);
      }
    });

    if (matches.length === 0) {
      return {
        ok: true,
        content: `No matches found in ${filePath}`,
      };
    }

    return {
      ok: true,
      content: `Found ${matches.length} matches in ${filePath}:\n${matches.slice(0, 50).join('\n')}${matches.length > 50 ? '\n... (truncated)' : ''}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function searchDirectory(dirPath: string, pattern: string, filePattern?: string): Promise<ToolResult> {
  const glob = await import('fast-glob');
  
  const globPattern = filePattern 
    ? `${dirPath}/**/${filePattern}`
    : `${dirPath}/**/*`;
  
  try {
    const files = await glob.default([globPattern], {
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      absolute: true,
    });

    const regex = new RegExp(pattern, 'i');
    const allMatches: Array<{ file: string; line: number; content: string }> = [];

    for (const file of files.slice(0, 100)) { // Limit to 100 files
      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, idx) => {
          if (regex.test(line)) {
            allMatches.push({
              file: file.replace(dirPath + '/', ''),
              line: idx + 1,
              content: line.trim(),
            });
          }
        });
      } catch {
        // Skip unreadable files
      }
    }

    if (allMatches.length === 0) {
      return {
        ok: true,
        content: `No matches found for pattern "${pattern}"`,
      };
    }

    const formatted = allMatches.slice(0, 30).map(m => 
      `${m.file}:${m.line}: ${m.content}`
    ).join('\n');

    return {
      ok: true,
      content: `Found ${allMatches.length} matches:\n${formatted}${allMatches.length > 30 ? '\n... (truncated)' : ''}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Directory search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
