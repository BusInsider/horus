// Fetch tool - HTTP requests
import { Tool, ToolContext, ToolResult } from './types.js';

export const fetchTool: Tool = {
  name: 'fetch',
  description: `Make HTTP requests to fetch data from URLs.
Supports GET, POST, PUT, DELETE methods with optional headers and body.`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch',
      },
      method: {
        type: 'string',
        description: 'HTTP method: GET, POST, PUT, DELETE',
        default: 'GET',
      },
      headers: {
        type: 'object',
        description: 'Optional headers (e.g., {"Authorization": "Bearer token"})',
      },
      body: {
        type: 'string',
        description: 'Request body for POST/PUT',
      },
    },
    required: ['url'],
  },

  async execute(args: { url: string; method?: string; headers?: Record<string, string>; body?: string }, _context: ToolContext): Promise<ToolResult> {
    try {
      const response = await fetch(args.url, {
        method: args.method || 'GET',
        headers: args.headers || {},
        body: args.body,
      });

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('application/json')) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        content = await response.text();
      }

      return {
        ok: true,
        content: `Status: ${response.status} ${response.statusText}\n\n${content.slice(0, 10000)}${content.length > 10000 ? '\n... (truncated)' : ''}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
