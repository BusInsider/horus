import { MemoryManager } from '../memory/manager.js';
import { Tool, ToolContext, ToolResult } from './types.js';

// These tools need the memory manager injected
export function createRecallTool(memory: MemoryManager): Tool {
  return {
    name: 'recall',
    description: `Query the agent's memory for past episodes, facts, or code.
This happens automatically before each LLM call, but you can use it 
for manual memory exploration.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in memory',
        },
        type: {
          type: 'string',
          enum: ['all', 'episodes', 'facts', 'code'],
          description: 'Type of memory to search',
          default: 'all',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return',
          default: 10,
        },
      },
      required: ['query'],
    },

    async execute(args: { query: string; type?: string; limit?: number }, context: ToolContext): Promise<ToolResult> {
      try {
        const memories = await memory.recall(args.query, args.limit);

        if (memories.length === 0) {
          return {
            ok: true,
            content: `No memories found for "${args.query}"`,
          };
        }

        const lines: string[] = [];
        lines.push(`Recalled ${memories.length} memories:\n`);

        for (const mem of memories) {
          const timestamp = mem.timestamp 
            ? new Date(mem.timestamp).toLocaleDateString() 
            : 'unknown';
          
          lines.push(`[${mem.type}] ${timestamp} (relevance: ${(mem.relevance * 100).toFixed(0)}%)`);
          
          // Truncate long content
          const content = mem.content.length > 300 
            ? mem.content.substring(0, 300) + '...' 
            : mem.content;
          lines.push(content);
          lines.push('');
        }

        return {
          ok: true,
          content: lines.join('\n'),
          annotations: {
            memoryCount: memories.length,
            query: args.query,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Recall failed',
        };
      }
    },
  };
}

export function createRememberTool(memory: MemoryManager): Tool {
  return {
    name: 'remember',
    description: `Store a fact in the agent's long-term semantic memory.
Use this for important information the agent should remember across sessions,
such as user preferences, project patterns, or learned insights.`,
    parameters: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to remember',
        },
        category: {
          type: 'string',
          description: 'Category: user_pref, codebase, pattern, api, bugfix, etc',
          default: 'general',
        },
      },
      required: ['fact'],
    },

    async execute(args: { fact: string; category?: string }, context: ToolContext): Promise<ToolResult> {
      try {
        await memory.storeFact(
          args.category || 'general',
          args.fact,
          context.sessionId,
          1.0
        );

        return {
          ok: true,
          content: `Remembered: ${args.fact}`,
          annotations: {
            category: args.category || 'general',
            fact: args.fact,
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Remember failed',
        };
      }
    },
  };
}

export function createIndexWorkspaceTool(memory: MemoryManager): Tool {
  return {
    name: 'index',
    description: `Index the current workspace for semantic code search.
This happens automatically when starting a session, but you can use it
to force re-indexing after major changes.`,
    parameters: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force full re-index (default: incremental)',
          default: false,
        },
      },
    },

    async execute(args: { force?: boolean }, context: ToolContext): Promise<ToolResult> {
      try {
        const result = await memory.indexWorkspace(context.cwd);

        return {
          ok: true,
          content: `Indexed ${result.files} files, ${result.chunks} code chunks`,
          annotations: result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Indexing failed',
        };
      }
    },
  };
}
