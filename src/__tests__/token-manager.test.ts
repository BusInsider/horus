import { describe, it, expect } from '@jest/globals';
import { TokenManager } from '../token-manager.js';

describe('TokenManager', () => {
  it('should estimate tokens from text', () => {
    const manager = new TokenManager();
    const text = 'Hello world, this is a test message.';
    const tokens = manager.estimateTokens(text);
    
    // Rough estimate: 1 token per 4 characters
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });

  it('should track usage correctly', () => {
    const manager = new TokenManager();
    manager.resetUsage();
    
    const usage = manager.getUsage();
    expect(usage.total).toBe(0);
    expect(usage.available).toBeGreaterThan(0);
  });

  it('should handle empty text', () => {
    const manager = new TokenManager();
    expect(manager.estimateTokens('')).toBe(0);
    expect(manager.estimateTokens(null as any)).toBe(0);
    expect(manager.estimateTokens(undefined as any)).toBe(0);
  });

  it('should estimate message tokens', () => {
    const manager = new TokenManager();
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    
    const tokens = manager.estimateMessages(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should check context size', () => {
    const manager = new TokenManager({ maxTokens: 100000 });
    
    const messages = [{ role: 'user', content: 'a'.repeat(50000) }];
    const result = manager.validateContextSize(messages);
    
    expect(result.valid).toBeDefined();
    if (!result.valid) {
      expect(result.reason).toBeDefined();
    }
  });
});
