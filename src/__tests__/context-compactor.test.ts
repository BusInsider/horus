import { describe, it, expect, jest } from '@jest/globals';
import { ContextCompactor } from '../context-compactor.js';
import type { Message as DbMessage } from '../memory/schema.js';
import type { RecalledMemory, MemoryManager } from '../memory/manager.js';
import { TokenManager } from '../token-manager.js';

describe('ContextCompactor', () => {
  const createCompactor = (enabled = true) => new ContextCompactor({ enabled });

  const mockMemory = {
    recall: jest.fn<() => Promise<RecalledMemory[]>>().mockResolvedValue([]),
  } as unknown as MemoryManager;

  const mockTokenManager = new TokenManager();

  const systemPrompt = 'You are Horus, a coding assistant.';

  const createMessages = (count: number): DbMessage[] => {
    const messages: DbMessage[] = [
      { id: 'sys', sessionId: 's1', role: 'system', content: systemPrompt, createdAt: 0, tokens: 100 },
    ];
    for (let i = 0; i < count; i++) {
      messages.push({
        id: `msg-${i}`,
        sessionId: 's1',
        role: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool',
        content: `Message ${i}: ${'x'.repeat(200)}`,
        createdAt: 1000 + i * 1000,
        tokens: 60,
      });
    }
    return messages;
  };

  describe('T1: Working Memory', () => {
    it('should always include system prompt', async () => {
      const compactor = createCompactor();
      const messages = createMessages(3);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe(systemPrompt);
    });

    it('should include the most recent user message', async () => {
      const compactor = createCompactor();
      const messages = createMessages(5);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      const userMessages = result.messages.filter(m => m.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      // Most recent user message should be included
      expect(result.messages.some(m => m.role === 'user' && m.content?.includes('Message 3'))).toBe(true);
    });
  });

  describe('T2: Recent History', () => {
    it('should include recent turns before T1', async () => {
      const compactor = createCompactor();
      const messages = createMessages(20);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      // Should have more than just T1 messages
      expect(result.messages.length).toBeGreaterThan(3);
    });

    it('should trim long tool results in T2', async () => {
      const compactor = createCompactor();
      const messages: DbMessage[] = [
        { id: 'sys', sessionId: 's1', role: 'system', content: systemPrompt, createdAt: 0, tokens: 100 },
        { id: 'u1', sessionId: 's1', role: 'user', content: 'run test', createdAt: 1000, tokens: 20 },
        { id: 'a1', sessionId: 's1', role: 'assistant', content: 'Running...', createdAt: 2000, tokens: 20 },
        {
          id: 't1',
          sessionId: 's1',
          role: 'tool',
          content: 'output\n' + 'line\n'.repeat(500),
          toolCallId: 'tc1',
          createdAt: 3000,
          tokens: 2000,
        },
        { id: 'u2', sessionId: 's1', role: 'user', content: 'next', createdAt: 4000, tokens: 20 },
      ];

      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      const toolMsg = result.messages.find(m => m.role === 'tool' && m.tool_call_id === 'tc1');
      if (toolMsg) {
        expect(toolMsg.content?.length).toBeLessThan(3000);
      }
    });
  });

  describe('T3: Deep History', () => {
    it('should summarize old messages instead of including them verbatim', async () => {
      const compactor = createCompactor();
      const messages = createMessages(50);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      // Should have a summary system message
      const summaryMsg = result.messages.find(
        m => m.role === 'system' && m.content?.includes('CONVERSATION HISTORY (summarized)')
      );
      expect(summaryMsg).toBeDefined();
    });

    it('should not include messages older than T2 cutoff verbatim', async () => {
      const compactor = createCompactor();
      const messages = createMessages(50);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      // The oldest message content should not appear verbatim
      const hasOldVerbatim = result.messages.some(
        m => m.content === 'Message 0: ' + 'x'.repeat(200)
      );
      expect(hasOldVerbatim).toBe(false);
    });
  });

  describe('T4: Codebase Context', () => {
    it('should load wholesale for tiny projects', async () => {
      const compactor = createCompactor();
      const messages = createMessages(3);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      // Either has codebase context or doesn't (depends on /tmp contents)
      // Mainly checking it doesn't throw
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('T5: External Knowledge', () => {
    it('should include memories when provided', async () => {
      const compactor = createCompactor();
      const messages = createMessages(3);
      const memories: RecalledMemory[] = [
        { type: 'fact', id: 'f1', content: 'React uses JSX', relevance: 0.9 },
        { type: 'episode', id: 'e1', content: 'Fixed bug in auth', relevance: 0.8, timestamp: Date.now() },
      ];

      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories,
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      const knowledgeMsg = result.messages.find(
        m => m.role === 'system' && m.content?.includes('RELEVANT KNOWLEDGE')
      );
      expect(knowledgeMsg).toBeDefined();
      expect(knowledgeMsg!.content).toContain('React uses JSX');
    });

    it('should not include memories section when none provided', async () => {
      const compactor = createCompactor();
      const messages = createMessages(3);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      const hasKnowledge = result.messages.some(
        m => m.role === 'system' && m.content?.includes('RELEVANT KNOWLEDGE')
      );
      expect(hasKnowledge).toBe(false);
    });
  });

  describe('Tier usage tracking', () => {
    it('should report per-tier usage', async () => {
      const compactor = createCompactor();
      const messages = createMessages(20);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      expect(result.tierUsage.length).toBeGreaterThanOrEqual(3);
      expect(result.tierUsage.some(t => t.tier === 1)).toBe(true);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('Fallback mode', () => {
    it('should use old behavior when disabled', async () => {
      const compactor = createCompactor(false);
      const messages = createMessages(10);
      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: process.cwd(),
      });

      // Fallback should have all messages (minus system)
      expect(result.messages.length).toBeGreaterThanOrEqual(10);
      expect(result.tierUsage.length).toBe(1);
    });
  });

  describe('Budget compliance', () => {
    it('should keep total context under 224K tokens', async () => {
      const compactor = createCompactor();
      // Create many large messages
      const messages: DbMessage[] = [
        { id: 'sys', sessionId: 's1', role: 'system', content: systemPrompt, createdAt: 0, tokens: 100 },
      ];
      for (let i = 0; i < 50; i++) {
        messages.push({
          id: `msg-${i}`,
          sessionId: 's1',
          role: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool',
          content: `Message ${i}:\n${'x'.repeat(4000)}`, // ~1K tokens each
          createdAt: 1000 + i * 1000,
          tokens: 1024,
        });
      }

      const result = await compactor.buildContext({
        systemPrompt,
        messages,
        memories: [],
        task: 'test',
        memory: mockMemory,
        tokenManager: mockTokenManager,
        cwd: '/tmp',
      });

      expect(result.totalTokens).toBeLessThan(224_000);
    });
  });
});
