// Tool tests

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { viewTool } from '../src/tools/view.js';
import { editTool } from '../src/tools/edit.js';
import { bashTool } from '../src/tools/bash.js';
import { globTool } from '../src/tools/glob.js';
import { ToolContext } from '../src/tools/types.js';

const TEST_DIR = join(tmpdir(), `horus-tools-test-${Date.now()}`);

describe('View Tool', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(join(TEST_DIR, 'test.txt'), 'Hello World', 'utf-8');
    await fs.mkdir(join(TEST_DIR, 'subdir'), { recursive: true });
    await fs.writeFile(join(TEST_DIR, 'subdir', 'file.ts'), 'const x = 1;', 'utf-8');
  });

  afterAll(async () => {
    try { await fs.rm(TEST_DIR, { recursive: true }); } catch {}
  });

  it('should view a file', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await viewTool.execute({ path: 'test.txt' }, context);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Hello World');
    }
  });

  it('should view a directory', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await viewTool.execute({ path: '.' }, context);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('test.txt');
    }
  });

  it('should handle view range', async () => {
    // Create file with multiple lines
    const lines = Array(20).fill(0).map((_, i) => `Line ${i + 1}`).join('\n');
    await fs.writeFile(join(TEST_DIR, 'multiline.txt'), lines, 'utf-8');

    const context: ToolContext = { cwd: TEST_DIR };
    const result = await viewTool.execute({ path: 'multiline.txt', viewRange: [5, 10] }, context);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Line 5');
      expect(result.content).toContain('Line 10');
    }
  });
});

describe('Edit Tool', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    try { await fs.rm(TEST_DIR, { recursive: true }); } catch {}
  });

  it('should create a new file', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await editTool.execute({
      path: 'newfile.txt',
      oldString: '',
      newString: 'New content',
    }, context);
    
    expect(result.ok).toBe(true);
    
    const content = await fs.readFile(join(TEST_DIR, 'newfile.txt'), 'utf-8');
    expect(content).toBe('New content');
  });

  it('should edit an existing file', async () => {
    await fs.writeFile(join(TEST_DIR, 'editme.txt'), 'Hello World', 'utf-8');

    const context: ToolContext = { cwd: TEST_DIR };
    const result = await editTool.execute({
      path: 'editme.txt',
      oldString: 'Hello World',
      newString: 'Hello Universe',
    }, context);
    
    expect(result.ok).toBe(true);
    
    const content = await fs.readFile(join(TEST_DIR, 'editme.txt'), 'utf-8');
    expect(content).toBe('Hello Universe');
  });

  it('should fail when oldString does not match', async () => {
    await fs.writeFile(join(TEST_DIR, 'nomatch.txt'), 'Original content', 'utf-8');

    const context: ToolContext = { cwd: TEST_DIR };
    const result = await editTool.execute({
      path: 'nomatch.txt',
      oldString: 'Non-existent string',
      newString: 'New content',
    }, context);
    
    expect(result.ok).toBe(false);
  });
});

describe('Glob Tool', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(join(TEST_DIR, 'a.ts'), '', 'utf-8');
    await fs.writeFile(join(TEST_DIR, 'b.ts'), '', 'utf-8');
    await fs.writeFile(join(TEST_DIR, 'c.js'), '', 'utf-8');
  });

  afterAll(async () => {
    try { await fs.rm(TEST_DIR, { recursive: true }); } catch {}
  });

  it('should find files matching pattern', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await globTool.execute({ pattern: '*.ts' }, context);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('a.ts');
      expect(result.content).toContain('b.ts');
    }
  });
});

describe('Bash Tool', () => {
  it('should execute echo command', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await bashTool.execute({
      command: 'echo "Hello from bash"',
    }, context);
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Hello from bash');
    }
  });

  it('should block dangerous commands', async () => {
    const context: ToolContext = { cwd: TEST_DIR };
    const result = await bashTool.execute({
      command: 'rm -rf /',
    }, context);
    
    expect(result.ok).toBe(false);
  });
});
