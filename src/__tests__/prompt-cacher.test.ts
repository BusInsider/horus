import { describe, it, expect } from '@jest/globals';
import { 
  PromptCacheManager, 
  buildContextReminder,
  buildHorusSystemPrompt,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY 
} from '../prompt-cacher.js';

describe('PromptCacheManager', () => {
  it('should build prompt with boundary marker', () => {
    const manager = new PromptCacheManager();
    
    manager.addStaticSection('Static content', 10);
    manager.setMemoizedSection('key', 'Memoized content');
    manager.setVolatileComputer(() => 'Volatile content');
    
    const prompt = manager.buildPrompt();
    
    expect(prompt.full).toContain('Static content');
    expect(prompt.full).toContain('Memoized content');
    expect(prompt.full).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    expect(prompt.full).toContain('Volatile content');
  });

  it('should calculate cache hit rate', () => {
    const manager = new PromptCacheManager();
    
    // Mostly static content
    manager.addStaticSection('a'.repeat(400), 10); // ~100 tokens
    manager.setVolatileComputer(() => 'b'.repeat(40)); // ~10 tokens
    
    const prompt = manager.buildPrompt();
    
    expect(prompt.cacheHitRate).toBeGreaterThan(0.8);
  });

  it('should sort sections by priority', () => {
    const manager = new PromptCacheManager();
    
    manager.addStaticSection('Low priority', 1);
    manager.addStaticSection('High priority', 10);
    manager.addStaticSection('Medium priority', 5);
    
    const prompt = manager.buildPrompt();
    const idx = prompt.full.indexOf.bind(prompt.full);
    
    expect(idx('High priority')).toBeLessThan(idx('Medium priority'));
    expect(idx('Medium priority')).toBeLessThan(idx('Low priority'));
  });
});

describe('buildContextReminder', () => {
  it('should build context reminder with all fields', () => {
    const reminder = buildContextReminder({
      cwd: '/home/user/project',
      date: '2026-04-08',
      gitBranch: 'main',
      recentFiles: ['src/index.ts', 'src/config.ts'],
      claudeMdContent: 'Use TypeScript strict mode',
    });
    
    expect(reminder).toContain('<system-reminder>');
    expect(reminder).toContain('</system-reminder>');
    expect(reminder).toContain('/home/user/project');
    expect(reminder).toContain('2026-04-08');
    expect(reminder).toContain('main');
    expect(reminder).toContain('src/index.ts');
    expect(reminder).toContain('TypeScript strict mode');
  });

  it('should handle minimal context', () => {
    const reminder = buildContextReminder({
      cwd: '/test',
      date: '2026-04-08',
    });
    
    expect(reminder).toContain('<system-reminder>');
    expect(reminder).toContain('/test');
    expect(reminder).not.toContain('recentFiles');
    expect(reminder).not.toContain('claudeMd');
  });
});

describe('buildHorusSystemPrompt', () => {
  it('should build complete system prompt', () => {
    const prompt = buildHorusSystemPrompt({
      mode: 'semi',
      showMemoryOperations: true,
      memoryEnabled: true,
    });
    
    expect(prompt.full).toContain('Horus');
    expect(prompt.full).toContain('semi');
    expect(prompt.full).toContain('recall');
    expect(prompt.full).toContain('remember');
    expect(prompt.cacheHitRate).toBeGreaterThan(0);
  });

  it('should omit memory section when disabled', () => {
    const prompt = buildHorusSystemPrompt({
      mode: 'auto',
      showMemoryOperations: false,
      memoryEnabled: false,
    });
    
    expect(prompt.full).not.toContain('Memory system');
  });
});
