// File operations - Simple file utilities
import { promises as fs } from 'fs';
import { join, isAbsolute, dirname } from 'path';
import { Tool, ToolContext, ToolResult } from './types.js';

export const catTool: Tool = {
  name: 'cat',
  description: 'Read file contents (simpler alternative to view)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to file to read',
      },
    },
    required: ['path'],
  },

  async execute(args: { path: string }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      return {
        ok: true,
        content: content.slice(0, 10000) + (content.length > 10000 ? '\n... (truncated)' : ''),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to read file',
      };
    }
  },
};

export const lsTool: Tool = {
  name: 'ls',
  description: 'List directory contents (simpler alternative to view)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to directory (default: current)',
      },
      all: {
        type: 'boolean',
        description: 'Show hidden files',
        default: false,
      },
    },
    required: [],
  },

  async execute(args: { path?: string; all?: boolean }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path || '.') ? args.path! : join(context.cwd, args.path || '.');

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      
      const lines: string[] = [];
      for (const entry of entries) {
        if (!args.all && entry.name.startsWith('.')) continue;
        lines.push(entry.isDirectory() ? `${entry.name}/` : entry.name);
      }

      return {
        ok: true,
        content: lines.join('\n') || '(empty directory)',
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list directory',
      };
    }
  },
};

export const mkdirTool: Tool = {
  name: 'mkdir',
  description: 'Create a directory',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to directory to create',
      },
      recursive: {
        type: 'boolean',
        description: 'Create parent directories if needed',
        default: true,
      },
    },
    required: ['path'],
  },

  async execute(args: { path: string; recursive?: boolean }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);

    try {
      await fs.mkdir(targetPath, { recursive: args.recursive !== false });
      return {
        ok: true,
        content: `Created directory: ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to create directory',
      };
    }
  },
};

export const rmTool: Tool = {
  name: 'rm',
  description: 'Remove a file or directory',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to file or directory to remove',
      },
      recursive: {
        type: 'boolean',
        description: 'Remove directories recursively',
        default: false,
      },
    },
    required: ['path'],
  },

  async execute(args: { path: string; recursive?: boolean }, context: ToolContext): Promise<ToolResult> {
    const targetPath = isAbsolute(args.path) ? args.path : join(context.cwd, args.path);

    try {
      await fs.rm(targetPath, { recursive: args.recursive });
      return {
        ok: true,
        content: `Removed: ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to remove',
      };
    }
  },
};
