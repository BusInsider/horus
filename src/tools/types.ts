// Tool type definitions

export interface ToolContext {
  cwd: string;
  sessionId?: string;
}

export type ToolResult = 
  | { ok: true; content: string; annotations?: Record<string, any> }
  | { ok: false; error: string; };

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any, context: ToolContext) => Promise<ToolResult>;
  executeStream?: (args: any, context: ToolContext) => AsyncIterable<string>;
}

// Helper to create tool definitions for Kimi API
export function createToolDefinition(tool: Tool) {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
