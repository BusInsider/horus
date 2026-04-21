import { describe, it, expect } from '@jest/globals';
import { loadConfig } from '../config.js';

describe('Config', () => {
  it('should load default config when none exists', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.provider).toBeDefined();
    expect(config.provider.model).toBe('kimi-k2-6');
  });

  it('should have a valid Kimi API endpoint', () => {
    const config = loadConfig();
    // Should be one of the valid Kimi/Moonshot endpoints
    const validEndpoints = [
      /^https:\/\/api\.kimi\.com\/coding\/v1$/,
      /^https:\/\/api\.moonshot\.ai\/v1$/,
      /^https:\/\/api\.moonshot\.cn\/v1$/,
    ];
    const matches = validEndpoints.some(pattern => pattern.test(config.provider.baseUrl));
    expect(matches).toBe(true);
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
