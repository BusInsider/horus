// Core functionality tests for Horus

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { MemoryManager } from '../src/memory/manager.js';
import { CheckpointManager } from '../src/checkpoint.js';
import { PlanManager } from '../src/plan.js';

const TEST_DB = join(tmpdir(), `horus-test-${Date.now()}.db`);
const TEST_DIR = join(tmpdir(), `horus-test-dir-${Date.now()}`);

describe('Memory System', () => {
  let memory: MemoryManager;
  let db: Database.Database;

  beforeAll(async () => {
    db = new Database(TEST_DB);
    memory = new MemoryManager({
      dbPath: TEST_DB,
      maxWorkingTokens: 10000,
    });
    await memory.initialize();
  });

  afterAll(() => {
    db.close();
    try { require('fs').unlinkSync(TEST_DB); } catch {}
  });

  it('should create a session', async () => {
    const session = await memory.startSession('/test/project');
    expect(session.id).toBeDefined();
    expect(session.cwd).toBe('/test/project');
    expect(memory.getCurrentSession()).not.toBeNull();
  });

  it('should add and retrieve messages', async () => {
    await memory.addMessage({
      role: 'user',
      content: 'Hello, test message',
    });

    const messages = memory.getMessages();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[messages.length - 1].content).toBe('Hello, test message');
  });

  it('should record episodes', async () => {
    await memory.recordEpisode(
      'edit',
      'Edited test.ts',
      'Added console.log',
      'success',
      'File saved successfully'
    );

    const episodes = memory.getEpisodes();
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes[0].actionType).toBe('edit');
  });

  it('should store and retrieve facts', async () => {
    await memory.storeFact('codebase', 'Uses TypeScript', 'test', 1.0);
    
    const facts = memory.getFacts('codebase');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].fact).toBe('Uses TypeScript');
  });
});

describe('Checkpoint System', () => {
  let checkpointManager: CheckpointManager;
  let db: Database.Database;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    db = new Database(TEST_DB);
    checkpointManager = new CheckpointManager(db, TEST_DIR);
  });

  afterAll(() => {
    db.close();
    try { require('fs').rmSync(TEST_DIR, { recursive: true }); } catch {}
  });

  it('should create a checkpoint', async () => {
    const cp = await checkpointManager.create('Test checkpoint', 'test-session');
    expect(cp.id).toBeDefined();
    expect(cp.name).toBe('Test checkpoint');
  });

  it('should list checkpoints', () => {
    const checkpoints = checkpointManager.list('test-session');
    expect(checkpoints.length).toBeGreaterThan(0);
  });
});

describe('Plan System', () => {
  let planManager: PlanManager;

  beforeAll(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    planManager = new PlanManager(TEST_DIR);
  });

  afterAll(async () => {
    try { await fs.rm(TEST_DIR, { recursive: true }); } catch {}
  });

  it('should generate a plan', async () => {
    const plan = await planManager.generate('Test objective', 'Test context');
    expect(plan.objective).toBe('Test objective');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('should write and read plan', async () => {
    const plan = await planManager.generate('Test', 'Context');
    await planManager.writePlan(plan);
    
    const readPlan = await planManager.readPlan();
    expect(readPlan).not.toBeNull();
    expect(readPlan?.objective).toBe('Test');
  });
});
