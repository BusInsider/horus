import { describe, it, expect } from '@jest/globals';
import { IncrementalToolParser, StreamingToolExecutor } from '../streaming-executor.js';
import { Tool, ToolContext } from '../tools/types.js';

describe('IncrementalToolParser', () => {
  it('should parse complete tool calls', () => {
    const parser = new IncrementalToolParser();
    const chunk = 'Some text <search>{"pattern": "test"}</search> more text';
    
    const calls = Array.from(parser.processChunk(chunk));
    
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe('search');
    expect(calls[0].arguments).toEqual({ pattern: 'test' });
    expect(calls[0].complete).toBe(true);
  });

  it('should parse multiple tool calls in one chunk', () => {
    const parser = new IncrementalToolParser();
    const chunk = '<view>{"path": "/file1"}</view><view>{"path": "/file2"}</view>';
    
    const calls = Array.from(parser.processChunk(chunk));
    
    expect(calls.length).toBe(2);
    // Order depends on parsing - just check both exist
    const paths = calls.map(c => c.arguments.path).sort();
    expect(paths[0]).toBe('/file1');
    expect(paths[1]).toBe('/file2');
  });

  it('should handle chunked tool calls', () => {
    const parser = new IncrementalToolParser();
    
    // First chunk - incomplete
    let calls = Array.from(parser.processChunk('<view>{"path":'));
    expect(calls.length).toBe(0);
    
    // Second chunk - complete
    calls = Array.from(parser.processChunk(' "/file"}</view>'));
    expect(calls.length).toBe(1);
    expect(calls[0].arguments.path).toBe('/file');
  });

  it('should generate unique IDs', () => {
    const parser = new IncrementalToolParser();
    
    const chunk = '<view>{"path": "/a"}</view><view>{"path": "/b"}</view>';
    const calls = Array.from(parser.processChunk(chunk));
    
    expect(calls[0].id).not.toBe(calls[1].id);
    expect(calls[0].id).toMatch(/call_\d+/);
  });
});

describe('StreamingToolExecutor', () => {
  const mockTool: Tool = {
    name: 'test',
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    execute: async (args) => ({ ok: true, content: `Result: ${JSON.stringify(args)}` }),
  };

  it('should process stream and execute tools', async () => {
    const executor = new StreamingToolExecutor({ enableMidStreamExecution: false });
    const tools = new Map([['test', mockTool]]);
    const context: ToolContext = { cwd: '/test' };
    
    async function* generateStream() {
      yield 'Text <test>{"arg": "value"}</test> more text';
    }
    
    const events: string[] = [];
    for await (const event of executor.processStream(generateStream(), tools, context)) {
      events.push(event.type);
    }
    
    expect(events).toContain('token');
    expect(events).toContain('tool_start');
    expect(events).toContain('done');
  });

  it('should handle execution errors gracefully', async () => {
    const errorTool: Tool = {
      name: 'error',
      description: 'Errors',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: false, error: 'Tool failed' }),
    };
    
    const executor = new StreamingToolExecutor({ enableMidStreamExecution: false });
    const tools = new Map([['error', errorTool]]);
    const context: ToolContext = { cwd: '/test' };
    
    async function* generateStream() {
      yield '<error>{}</error>';
    }
    
    const events: string[] = [];
    for await (const event of executor.processStream(generateStream(), tools, context)) {
      events.push(event.type);
      if (event.type === 'tool_complete') {
        // Tool should complete with error result, not throw
        expect(event.result).toBeDefined();
      }
    }
    
    expect(events).toContain('tool_complete');
    expect(events).toContain('done');
  });
});
