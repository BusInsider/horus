// Subagent system for parallel task execution
// Hermes-style Task() equivalent

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';

export interface SubagentTask {
  id: string;
  parentSessionId: string;
  description: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeout: number;
  cwd: string;
}

export interface SubagentConfig {
  db: Database.Database;
  horusPath: string;
  maxConcurrent: number;
  defaultTimeout: number;
}

export class SubagentManager {
  private db: Database.Database;
  private horusPath: string;
  private maxConcurrent: number;
  private defaultTimeout: number;
  private runningTasks: Map<string, ReturnType<typeof spawn>> = new Map();

  constructor(config: SubagentConfig) {
    this.db = config.db;
    this.horusPath = config.horusPath;
    this.maxConcurrent = config.maxConcurrent;
    this.defaultTimeout = config.defaultTimeout;
  }

  // Spawn a new subagent task
  spawn(options: {
    parentSessionId: string;
    description: string;
    prompt: string;
    cwd: string;
    timeout?: number;
  }): string {
    const id = randomUUID();
    const now = Date.now();

    const task: SubagentTask = {
      id,
      parentSessionId: options.parentSessionId,
      description: options.description,
      prompt: options.prompt,
      status: 'pending',
      createdAt: now,
      timeout: options.timeout || this.defaultTimeout,
      cwd: options.cwd,
    };

    this.saveTask(task);
    this.executeTask(task);

    return id;
  }

  // Get task status
  status(taskId: string): SubagentTask | null {
    return this.getTask(taskId);
  }

  // Wait for task to complete
  async wait(taskId: string): Promise<SubagentTask> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const task = this.getTask(taskId);
        if (!task) {
          clearInterval(checkInterval);
          reject(new Error(`Task not found: ${taskId}`));
          return;
        }

        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(checkInterval);
          resolve(task);
        }
      }, 100);

      // Timeout after task timeout + 10s buffer
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Task wait timeout: ${taskId}`));
      }, (this.getTask(taskId)?.timeout || this.defaultTimeout) * 1000 + 10000);
    });
  }

  // Wait for multiple tasks
  async waitAll(taskIds: string[]): Promise<SubagentTask[]> {
    return Promise.all(taskIds.map(id => this.wait(id)));
  }

  // Stop a running task
  stop(taskId: string, reason: string = 'Stopped by user'): boolean {
    const child = this.runningTasks.get(taskId);
    if (child) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);

      this.updateTaskStatus(taskId, 'stopped', undefined, reason);
      this.runningTasks.delete(taskId);
      return true;
    }
    return false;
  }

  // List tasks for a session
  list(parentSessionId: string): SubagentTask[] {
    const rows = this.db
      .prepare('SELECT * FROM subagents WHERE parent_session_id = ? ORDER BY created_at DESC')
      .all(parentSessionId) as any[];

    return rows.map(row => this.rowToTask(row));
  }

  // List all running tasks
  listRunning(): SubagentTask[] {
    const rows = this.db
      .prepare("SELECT * FROM subagents WHERE status = 'running'")
      .all() as any[];

    return rows.map(row => this.rowToTask(row));
  }

  // Cancel all tasks for a session
  cancelAll(parentSessionId: string): number {
    const tasks = this.list(parentSessionId);
    let cancelled = 0;

    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'running') {
        this.stop(task.id, 'Cancelled by parent session');
        cancelled++;
      }
    }

    return cancelled;
  }

  private async executeTask(task: SubagentTask): Promise<void> {
    // Check concurrent limit
    const running = this.listRunning().length;
    if (running >= this.maxConcurrent) {
      // Wait for a slot
      await this.waitForSlot();
    }

    // Update status
    this.updateTaskStatus(task.id, 'running');

    // Create a temporary file with the prompt
    const { promises: fs } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    const promptFile = join(tmpdir(), `horus-task-${task.id}.txt`);
    await fs.writeFile(promptFile, task.prompt, 'utf-8');

    // Spawn the subagent
    const child = spawn('node', [this.horusPath, 'run', task.description, task.cwd], {
      cwd: task.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HORUS_TASK_ID: task.id,
        HORUS_PARENT_SESSION: task.parentSessionId,
        HORUS_PROMPT_FILE: promptFile,
      },
    });

    this.runningTasks.set(task.id, child);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set timeout
    const timeout = setTimeout(() => {
      this.stop(task.id, 'Timeout exceeded');
    }, task.timeout * 1000);

    child.on('close', async (code) => {
      clearTimeout(timeout);
      this.runningTasks.delete(task.id);

      // Clean up prompt file
      try {
        await fs.unlink(promptFile);
      } catch {
        // Ignore
      }

      if (code === 0) {
        this.updateTaskStatus(task.id, 'completed', stdout + stderr);
      } else {
        this.updateTaskStatus(task.id, 'failed', stdout + stderr, `Exit code: ${code}`);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      this.runningTasks.delete(task.id);
      this.updateTaskStatus(task.id, 'failed', undefined, error.message);
    });
  }

  private async waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const running = this.listRunning().length;
        if (running < this.maxConcurrent) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  private saveTask(task: SubagentTask): void {
    const stmt = this.db.prepare(`
      INSERT INTO subagents (
        id, parent_session_id, description, prompt, status, 
        created_at, timeout, cwd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.parentSessionId,
      task.description,
      task.prompt,
      task.status,
      task.createdAt,
      task.timeout,
      task.cwd
    );
  }

  private getTask(id: string): SubagentTask | null {
    const row = this.db.prepare('SELECT * FROM subagents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToTask(row);
  }

  private updateTaskStatus(
    id: string,
    status: SubagentTask['status'],
    result?: string,
    error?: string
  ): void {
    const updates: string[] = ['status = ?'];
    const params: any[] = [status];

    if (result !== undefined) {
      updates.push('result = ?');
      params.push(result);
    }

    if (error !== undefined) {
      updates.push('error = ?');
      params.push(error);
    }

    if (status === 'running') {
      updates.push('started_at = ?');
      params.push(Date.now());
    }

    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      updates.push('completed_at = ?');
      params.push(Date.now());
    }

    params.push(id);

    this.db.prepare(`UPDATE subagents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  private rowToTask(row: any): SubagentTask {
    return {
      id: row.id,
      parentSessionId: row.parent_session_id,
      description: row.description,
      prompt: row.prompt,
      status: row.status,
      result: row.result,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      timeout: row.timeout,
      cwd: row.cwd,
    };
  }
}

// SQL for subagents table
export const SUBAGENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  timeout INTEGER NOT NULL,
  cwd TEXT NOT NULL,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subagents_parent ON subagents(parent_session_id, status);
CREATE INDEX IF NOT EXISTS idx_subagents_status ON subagents(status);
`;

// Tool definitions for subagent tools
export const subagentTools = {
  spawn: {
    name: 'spawn',
    description: 'Spawn a subagent to execute a task in parallel',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short description of the task' },
        prompt: { type: 'string', description: 'Full instructions for the subagent' },
        timeout: { type: 'number', description: 'Timeout in seconds' },
      },
      required: ['description', 'prompt'],
    },
  },
  wait: {
    name: 'wait',
    description: 'Wait for a subagent to complete',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to wait for' },
      },
      required: ['taskId'],
    },
  },
  status: {
    name: 'status',
    description: 'Get status of a subagent task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  list: {
    name: 'list',
    description: 'List all subagent tasks',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};
