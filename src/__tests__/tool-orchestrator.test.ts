import { describe, it, expect } from '@jest/globals';
import { ToolOrchestrator, ToolCall } from '../tools/orchestrator.js';
import { Tool, ToolContext } from '../tools/types.js';

describe('ToolOrchestrator', () => {
  const mockTool: Tool = {
    name: 'test',
    description: 'Test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, content: 'result' }),
  };

  it('should classify tools correctly', () => {
    const orchestrator = new ToolOrchestrator();
    
    const view = orchestrator.getClassification('view');
    expect(view.concurrency).toBe('read-only');
    
    const edit = orchestrator.getClassification('edit');
    expect(edit.concurrency).toBe('write');
    
    const bash = orchestrator.getClassification('bash');
    expect(bash.concurrency).toBe('blocking');
  });

  it('should partition read-only tools into parallel batches', () => {
    const orchestrator = new ToolOrchestrator(3); // Max 3 parallel
    
    const calls: ToolCall[] = [
      { id: '1', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
      { id: '2', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
      { id: '3', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
      { id: '4', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
    ];
    
    const batches = orchestrator.partitionBatches(calls);
    
    // Should split into 2 batches (3 + 1)
    expect(batches.length).toBe(2);
    expect(batches[0].length).toBe(3);
    expect(batches[1].length).toBe(1);
  });

  it('should separate read and write batches', () => {
    const orchestrator = new ToolOrchestrator();
    
    const calls: ToolCall[] = [
      { id: '1', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
      { id: '2', tool: mockTool, args: {}, classification: { name: 'edit', concurrency: 'write' } },
      { id: '3', tool: mockTool, args: {}, classification: { name: 'view', concurrency: 'read-only' } },
    ];
    
    const batches = orchestrator.partitionBatches(calls);
    
    // Should be 3 batches: [read], [write], [read]
    expect(batches.length).toBe(3);
    expect(batches[0][0].classification.concurrency).toBe('read-only');
    expect(batches[1][0].classification.concurrency).toBe('write');
    expect(batches[2][0].classification.concurrency).toBe('read-only');
  });

  it('should apply result budgets', async () => {
    const orchestrator = new ToolOrchestrator();
    
    const longResultTool: Tool = {
      name: 'long',
      description: 'Returns long result',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ ok: true, content: 'x'.repeat(1000) }),
    };
    
    const call: ToolCall = {
      id: '1',
      tool: longResultTool,
      args: {},
      classification: { name: 'long', concurrency: 'read-only', maxResultSizeChars: 100 },
    };
    
    const context: ToolContext = { cwd: '/test' };
    const results = await orchestrator.executeBatches([[call]], context);
    
    const result = results[0].result;
    if (typeof result === 'object' && 'ok' in result && result.ok) {
      expect(result.content).toContain('[Result truncated');
      expect(result.content.length).toBeLessThan(200);
    }
  });
});
