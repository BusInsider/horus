import { describe, it, expect } from '@jest/globals';
import { loadConfig } from '../config.js';

describe('Config', () => {
  it('should load default config when none exists', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.provider).toBeDefined();
    expect(config.provider.model).toBe('kimi-k2-5');
  });

  it('should have memory configuration', () => {
    const config = loadConfig();
    expect(config.memory).toBeDefined();
    expect(config.memory.dbPath).toContain('.horus');
  });

  it('should have workspace configuration', () => {
    const config = loadConfig();
    expect(config.workspace).toBeDefined();
    expect(config.workspace.defaultPath).toBeDefined();
  });
});
