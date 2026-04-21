import { describe, it, expect } from '@jest/globals';
import { ToolSelector } from '../utils/tool-selector.js';
import type { Tool } from '../tools/types.js';

describe('ToolSelector', () => {
  const mockTools = new Map<string, Tool>([
    ['view', { name: 'view', description: 'View files and directories', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['edit', { name: 'edit', description: 'Edit files by replacing text', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['bash', { name: 'bash', description: 'Execute bash commands', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['search', { name: 'search', description: 'Search code with ripgrep', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['git_status', { name: 'git_status', description: 'Show git status', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['git_diff', { name: 'git_diff', description: 'Show git diff', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['fetch', { name: 'fetch', description: 'Fetch URL content', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['recall', { name: 'recall', description: 'Recall memories', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['math', { name: 'math', description: 'Calculate math expressions', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
    ['skill_list', { name: 'skill_list', description: 'List available skills', parameters: { type: 'object', properties: {} }, execute: async () => ({ ok: true, content: '' }) }],
  ]);

  it('should always include core tools', () => {
    const selector = new ToolSelector({ maxTools: 6, coreTools: ['view', 'edit', 'bash', 'search'] });
    const selected = selector.select(mockTools, 'Hello world');
    const names = selected.map(t => t.name);

    expect(names).toContain('view');
    expect(names).toContain('edit');
    expect(names).toContain('bash');
    expect(names).toContain('search');
  });

  it('should select git tools when context mentions git', () => {
    const selector = new ToolSelector({ maxTools: 8, coreTools: ['view', 'edit', 'bash', 'search'] });
    const selected = selector.select(mockTools, 'Show me what changed in git');
    const names = selected.map(t => t.name);

    expect(names).toContain('git_status');
    expect(names).toContain('git_diff');
  });

  it('should select fetch when context mentions URL', () => {
    const selector = new ToolSelector({ maxTools: 8, coreTools: ['view', 'edit', 'bash', 'search'] });
    const selected = selector.select(mockTools, 'Fetch data from https://example.com');
    const names = selected.map(t => t.name);

    expect(names).toContain('fetch');
  });

  it('should select recall when context mentions memory', () => {
    const selector = new ToolSelector({ maxTools: 8, coreTools: ['view', 'edit', 'bash', 'search'] });
    const selected = selector.select(mockTools, 'What did we do before?');
    const names = selected.map(t => t.name);

    expect(names).toContain('recall');
  });

  it('should respect maxTools limit', () => {
    const selector = new ToolSelector({ maxTools: 6, coreTools: ['view', 'edit'] });
    const selected = selector.select(mockTools, 'Run tests and check git status');

    expect(selected.length).toBeLessThanOrEqual(6);
  });

  it('should include forced tools even if not relevant', () => {
    const selector = new ToolSelector({ maxTools: 6, coreTools: ['view', 'edit'] });
    const selected = selector.select(mockTools, 'Hello world', ['math']);
    const names = selected.map(t => t.name);

    expect(names).toContain('math');
  });

  it('should drop specialized tools in generic contexts', () => {
    const selector = new ToolSelector({ maxTools: 6, coreTools: ['view', 'edit', 'bash', 'search'] });
    const selected = selector.select(mockTools, 'Hello');
    const names = selected.map(t => t.name);

    // math and skill_list are specialized and should be dropped in generic context
    expect(names).not.toContain('skill_list');
  });

  it('should provide selection summary', () => {
    const selector = new ToolSelector({ maxTools: 6, coreTools: ['view', 'edit'] });
    const summary = selector.getSelectionSummary(mockTools, 'Show git status');

    expect(summary.selected.length).toBeGreaterThan(0);
    expect(summary.dropped.length).toBeGreaterThan(0);
    expect(Object.keys(summary.scores).length).toBe(mockTools.size);
  });
});
