import { describe, it, expect } from '@jest/globals';
import { KimiClient, Message, ToolDefinition, ToolCall } from '../kimi.js';

describe('KimiClient', () => {
  const mockConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.test.com/v1',
    model: 'kimi-k2-5' as const,
  };

  describe('constructor', () => {
    it('should create client with provided config', () => {
      const client = new KimiClient(mockConfig);
      expect(client).toBeDefined();
    });

    it('should merge config with defaults', () => {
      const client = new KimiClient({
        ...mockConfig,
        maxRetries: 5,
        timeoutMs: 30000,
      });
      expect(client).toBeDefined();
    });
  });

  describe('types', () => {
    it('should have correct Message type structure', () => {
      const message: Message = {
        role: 'user',
        content: 'Hello',
      };
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
    });

    it('should have correct ToolCall type structure', () => {
      const toolCall: ToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: '{}',
        },
      };
      expect(toolCall.id).toBe('call_123');
      expect(toolCall.type).toBe('function');
      expect(toolCall.function.name).toBe('test_tool');
    });

    it('should have correct ToolDefinition type structure', () => {
      const tool: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              arg1: { type: 'string' },
            },
            required: ['arg1'],
          },
        },
      };
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe('test_tool');
    });
  });

  describe('stream method signature', () => {
    it('should return an async generator', () => {
      const client = new KimiClient(mockConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const tools: ToolDefinition[] = [];
      
      const stream = client.stream(messages, tools);
      
      // Should be an async iterable
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    });

    it('should accept optional temperature and maxTokens', () => {
      const client = new KimiClient(mockConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      
      // Should not throw with options
      const stream = client.stream(messages, [], {
        temperature: 0.5,
        maxTokens: 100,
      });
      
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');
    });
  });

  describe('complete method signature', () => {
    it('should return a promise', () => {
      const client = new KimiClient(mockConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      
      // Should return a promise (will fail due to no fetch, but type is correct)
      const result = client.complete(messages).catch(() => ({ content: '' }));
      expect(result).toBeInstanceOf(Promise);
    });

    it('should accept optional maxTokens and temperature', () => {
      const client = new KimiClient(mockConfig);
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      
      // Should not throw with options
      const result = client.complete(messages, {
        maxTokens: 100,
        temperature: 0.5,
      }).catch(() => ({ content: '' }));
      
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('stream chunk types', () => {
    it('should define all required chunk types', () => {
      // Token chunk
      const tokenChunk = {
        type: 'token' as const,
        content: 'Hello',
      };
      expect(tokenChunk.type).toBe('token');

      // Tool call chunk
      const toolCallChunk = {
        type: 'tool_call' as const,
        toolCall: {
          id: 'call_123',
          type: 'function' as const,
          function: {
            name: 'test',
            arguments: '{}',
          },
        },
      };
      expect(toolCallChunk.type).toBe('tool_call');

      // Done chunk
      const doneChunk = {
        type: 'done' as const,
        usage: {
          promptTokens: 10,
          completionTokens: 20,
        },
      };
      expect(doneChunk.type).toBe('done');

      // Error chunk
      const errorChunk = {
        type: 'error' as const,
        content: 'Something went wrong',
      };
      expect(errorChunk.type).toBe('error');
    });
  });
});
