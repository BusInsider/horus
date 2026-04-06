// MCP (Model Context Protocol) Client for Horus
// Allows connecting to external tool servers

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool, TextContent, ImageContent } from '@modelcontextprotocol/sdk/types.js';

export interface MCPConnection {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpToolResult {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
}

export class MCPClient {
  private connections: Map<string, { client: Client; tools: Tool[] }> = new Map();
  private logger: any;

  constructor(logger?: any) {
    this.logger = logger || console;
  }

  async connect(name: string, config: MCPConnection): Promise<void> {
    this.logger.info(`Connecting to MCP server: ${name}`);

    try {
      let transport;

      if (config.transport === 'stdio') {
        if (!config.command) {
          throw new Error('Command required for stdio transport');
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env || process.env as Record<string, string>,
        });
      } else {
        throw new Error(`SSE transport not yet implemented`);
      }

      const client = new Client({ name: 'horus', version: '0.2.0' });
      await client.connect(transport);

      // List available tools
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools || [];

      this.connections.set(name, { client, tools });
      this.logger.info(`Connected to ${name} with ${tools.length} tools`);

    } catch (error) {
      this.logger.error(`Failed to connect to ${name}:`, error);
      throw error;
    }
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (conn) {
      await conn.client.close();
      this.connections.delete(name);
      this.logger.info(`Disconnected from ${name}`);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name] of this.connections) {
      await this.disconnect(name);
    }
  }

  getAllTools(): Array<{ server: string; tool: Tool }> {
    const allTools: Array<{ server: string; tool: Tool }> = [];
    
    for (const [serverName, { tools }] of this.connections) {
      for (const tool of tools) {
        allTools.push({ server: serverName, tool });
      }
    }

    return allTools;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<McpToolResult> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`Server not connected: ${serverName}`);
    }

    this.logger.debug(`Calling ${serverName}/${toolName}`, args);

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });

      return {
        content: result.content as (TextContent | ImageContent)[],
        isError: result.isError,
      };
    } catch (error) {
      this.logger.error(`Tool call failed: ${serverName}/${toolName}`, error);
      throw error;
    }
  }

  isConnected(name: string): boolean {
    return this.connections.has(name);
  }

  getConnectionNames(): string[] {
    return Array.from(this.connections.keys());
  }
}

// Convert MCP tool to Horus tool format
export function convertMcpToolToHorus(serverName: string, tool: Tool, client: MCPClient) {
  return {
    name: `${serverName}_${tool.name}`,
    description: `${tool.description || ''} (from ${serverName})`,
    parameters: tool.inputSchema || { type: 'object', properties: {} },
    execute: async (args: any) => {
      const result = await client.callTool(serverName, tool.name, args);
      
      // Extract text content
      const textContent = result.content
        .filter((c): c is TextContent => c.type === 'text')
        .map(c => c.text)
        .join('\n');

      if (result.isError) {
        return { ok: false, error: textContent };
      }

      return { ok: true, content: textContent };
    },
  };
}
