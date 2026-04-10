// JSON/YAML tools - Data parsing and validation
import { Tool, ToolContext, ToolResult } from './types.js';

export const jsonParseTool: Tool = {
  name: 'json_parse',
  description: 'Parse and validate JSON string, returns formatted JSON or error details',
  parameters: {
    type: 'object',
    properties: {
      json: {
        type: 'string',
        description: 'JSON string to parse',
      },
    },
    required: ['json'],
  },

  async execute(args: { json: string }, _context: ToolContext): Promise<ToolResult> {
    try {
      const parsed = JSON.parse(args.json);
      return {
        ok: true,
        content: `Valid JSON:\n${JSON.stringify(parsed, null, 2)}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
      };
    }
  },
};

export const jsonFormatTool: Tool = {
  name: 'json_format',
  description: 'Format/minify JSON string',
  parameters: {
    type: 'object',
    properties: {
      json: {
        type: 'string',
        description: 'JSON string to format',
      },
      minify: {
        type: 'boolean',
        description: 'Minify instead of pretty-print',
        default: false,
      },
    },
    required: ['json'],
  },

  async execute(args: { json: string; minify?: boolean }, _context: ToolContext): Promise<ToolResult> {
    try {
      const parsed = JSON.parse(args.json);
      const formatted = args.minify 
        ? JSON.stringify(parsed)
        : JSON.stringify(parsed, null, 2);
      return {
        ok: true,
        content: formatted,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
      };
    }
  },
};
