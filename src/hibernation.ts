// Hibernation Architecture - Save/Resume Agent State
// Enables checkpointing, cloning, and MCTS-style exploration

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createGzip, createGunzip } from 'zlib';

import { MemoryManager } from './memory/manager.js';
import { Message } from './kimi.js';




export interface AgentState {
  // Identity
  sessionId: string;
  parentSessionId?: string; // For tracking clones/branches
  hibernationId: string;
  createdAt: string;
  version: string;

  // Context
  cwd: string;
  env: Record<string, string>;
  iteration: number;
  
  // Conversation
  messages: Message[];
  workingMemory: string; // Summarized context
  
  // Tools and skills
  availableTools: string[]; // Tool names
  activeSkills: string[]; // Skill IDs
  
  // Plan state
  currentPlan?: {
    objective: string;
    steps: PlanStep[];
    currentStep: number;
  };

  // Metadata
  tags: string[];
  description: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  result?: string;
}

export interface HibernationCheckpoint {
  id: string;
  agentState: AgentState;
  memorySnapshot: Buffer; // Serialized SQLite data
  fileSnapshot?: FileSnapshot;
  createdAt: string;
  compressed: boolean;
}

export interface FileSnapshot {
  basePath: string;
  files: Record<string, {
    content: string;
    mtime: number;
  }>;
}

export interface CloneOptions {
  inheritMemory: boolean; // Clone with parent memory or start fresh
  inheritSkills: boolean;
  branchTag?: string; // Tag for MCTS branch tracking
  explorationParams?: {
    temperature: number;
    maxIterations: number;
  };
}

export interface ResumeOptions {
  fromIteration?: number; // Resume from specific iteration
  withModifications?: Partial<AgentState>; // Modify state on resume
}

export class HibernationManager {
  private checkpointDir: string;

  constructor(checkpointDir = '~/.horus/hibernation') {
    this.checkpointDir = this.expandHomeDir(checkpointDir);
  }

  private expandHomeDir(path: string): string {
    if (path.startsWith('~/')) {
      return join(process.env.HOME || process.env.USERPROFILE || '', path.slice(2));
    }
    return path;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.checkpointDir, { recursive: true });
  }

  // Create a checkpoint of current agent state
  async checkpoint(
    state: AgentState,
    memory: MemoryManager,
    options?: {
      compress?: boolean;
      fileSnapshot?: FileSnapshot;
    }
  ): Promise<HibernationCheckpoint> {
    const hibernationId = `hib_${randomUUID().slice(0, 8)}`;
    
    // Serialize memory
    const memorySnapshot = await this.serializeMemory(memory);
    
    // Compress if requested
    let finalSnapshot = memorySnapshot;
    let compressed = false;
    
    if (options?.compress) {
      finalSnapshot = await this.compress(memorySnapshot);
      compressed = true;
    }

    const checkpoint: HibernationCheckpoint = {
      id: hibernationId,
      agentState: state,
      memorySnapshot: finalSnapshot,
      fileSnapshot: options?.fileSnapshot,
      createdAt: new Date().toISOString(),
      compressed,
    };

    // Save checkpoint
    const checkpointPath = join(this.checkpointDir, `${hibernationId}.json`);
    await fs.writeFile(
      checkpointPath,
      JSON.stringify(checkpoint, this.checkpointReplacer, 2)
    );

    return checkpoint;
  }

  // Restore agent state from checkpoint
  async restore(
    checkpointId: string,
    options?: ResumeOptions
  ): Promise<{
    state: AgentState;
    memoryData: Buffer;
  }> {
    const checkpointPath = join(this.checkpointDir, `${checkpointId}.json`);
    const content = await fs.readFile(checkpointPath, 'utf-8');
    const checkpoint: HibernationCheckpoint = JSON.parse(content, this.checkpointReviver);

    // Decompress if needed
    let memoryData = checkpoint.memorySnapshot;
    if (checkpoint.compressed) {
      memoryData = await this.decompress(memoryData);
    }

    // Apply modifications if requested
    let state = checkpoint.agentState;
    if (options?.withModifications) {
      state = { ...state, ...options.withModifications };
    }

    return { state, memoryData };
  }

  // Clone an agent state for MCTS-style exploration
  async clone(
    parentCheckpointId: string,
    options: CloneOptions
  ): Promise<HibernationCheckpoint> {
    const parent = await this.restore(parentCheckpointId);
    
    const newState: AgentState = {
      ...parent.state,
      sessionId: `session_${randomUUID().slice(0, 8)}`,
      parentSessionId: parent.state.sessionId,
      hibernationId: `hib_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      iteration: 0, // Reset iteration for exploration
      tags: [...parent.state.tags, 'clone', options.branchTag || 'exploration'],
      description: `Clone of ${parent.state.sessionId}${options.branchTag ? ` [${options.branchTag}]` : ''}`,
    };

    // Clear working memory for exploration
    newState.workingMemory = '';
    
    // Modify based on exploration params
    if (options.explorationParams) {
      // These would be used by the agent during execution
      newState.tags.push(`temp-${options.explorationParams.temperature}`);
    }

    // Handle memory inheritance
    let memoryData = parent.memoryData;
    if (!options.inheritMemory) {
      // Start with empty memory
      memoryData = Buffer.from(''); // Empty SQLite db would be created fresh
    }

    // Create checkpoint without file snapshot (clones use current filesystem)
    const checkpoint: HibernationCheckpoint = {
      id: newState.hibernationId,
      agentState: newState,
      memorySnapshot: memoryData,
      createdAt: new Date().toISOString(),
      compressed: false,
    };

    const checkpointPath = join(this.checkpointDir, `${newState.hibernationId}.json`);
    await fs.writeFile(
      checkpointPath,
      JSON.stringify(checkpoint, this.checkpointReplacer, 2)
    );

    return checkpoint;
  }

  // Create a file snapshot for rollback capability
  async createFileSnapshot(basePath: string, files: string[]): Promise<FileSnapshot> {
    const snapshot: FileSnapshot = {
      basePath,
      files: {},
    };

    for (const file of files) {
      const fullPath = join(basePath, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const stat = await fs.stat(fullPath);
        snapshot.files[file] = {
          content,
          mtime: stat.mtimeMs,
        };
      } catch {
        // File doesn't exist or can't be read, skip
      }
    }

    return snapshot;
  }

  // Restore files from snapshot
  async restoreFileSnapshot(snapshot: FileSnapshot): Promise<void> {
    for (const [file, data] of Object.entries(snapshot.files)) {
      const fullPath = join(snapshot.basePath, file);
      await fs.mkdir(join(fullPath, '..'), { recursive: true });
      await fs.writeFile(fullPath, data.content);
    }
  }

  // List all checkpoints
  async listCheckpoints(): Promise<Array<{
    id: string;
    sessionId: string;
    description: string;
    createdAt: string;
    tags: string[];
    size: number;
  }>> {
    const entries = await fs.readdir(this.checkpointDir);
    const checkpoints = [];

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;

      const path = join(this.checkpointDir, entry);
      const stat = await fs.stat(path);
      const content = await fs.readFile(path, 'utf-8');
      const checkpoint: HibernationCheckpoint = JSON.parse(content);

      checkpoints.push({
        id: checkpoint.id,
        sessionId: checkpoint.agentState.sessionId,
        description: checkpoint.agentState.description,
        createdAt: checkpoint.createdAt,
        tags: checkpoint.agentState.tags,
        size: stat.size,
      });
    }

    return checkpoints.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // Delete a checkpoint
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    try {
      const path = join(this.checkpointDir, `${checkpointId}.json`);
      await fs.unlink(path);
      return true;
    } catch {
      return false;
    }
  }

  // Serialize memory to buffer
  private async serializeMemory(memory: MemoryManager): Promise<Buffer> {
    // Access the SQLite database through the private db property
    const db = (memory as unknown as { db: { serialize: () => Buffer } }).db;
    return db.serialize();
  }

  // Compress data
  private async compress(data: Buffer): Promise<Buffer> {
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
      gzip.on('end', () => resolve(Buffer.concat(chunks)));
      gzip.on('error', reject);
      gzip.end(data);
    });
  }

  // Decompress data
  private async decompress(data: Buffer): Promise<Buffer> {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));
      gunzip.on('error', reject);
      gunzip.end(data);
    });
  }

  // JSON replacer for checkpoint serialization
  private checkpointReplacer(_key: string, value: unknown): unknown {
    if (Buffer.isBuffer(value)) {
      return {
        type: 'Buffer',
        data: value.toString('base64'),
      };
    }
    return value;
  }

  // JSON reviver for checkpoint deserialization
  private checkpointReviver(_key: string, value: unknown): unknown {
    if (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as { type: string }).type === 'Buffer' &&
      'data' in value
    ) {
      return Buffer.from((value as { data: string }).data, 'base64');
    }
    return value;
  }

  // Compare two checkpoints (for MCTS evaluation)
  compareCheckpoints(
    a: HibernationCheckpoint,
    b: HibernationCheckpoint
  ): {
    iterationDelta: number;
    messageCountDelta: number;
    planProgressDelta: number;
  } {
    const iterationDelta = b.agentState.iteration - a.agentState.iteration;
    const messageCountDelta = b.agentState.messages.length - a.agentState.messages.length;
    
    const planProgressA = a.agentState.currentPlan 
      ? a.agentState.currentPlan.steps.filter(s => s.status === 'completed').length
      : 0;
    const planProgressB = b.agentState.currentPlan
      ? b.agentState.currentPlan.steps.filter(s => s.status === 'completed').length
      : 0;
    const planProgressDelta = planProgressB - planProgressA;

    return {
      iterationDelta,
      messageCountDelta,
      planProgressDelta,
    };
  }
}

// Singleton instance
let manager: HibernationManager | null = null;

export function getHibernationManager(): HibernationManager {
  if (!manager) {
    manager = new HibernationManager();
  }
  return manager;
}
