// Checkpoint system for rollback support
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Checkpoint {
  id: string;
  sessionId: string;
  name: string;
  type: 'git' | 'snapshot';
  gitRef?: string;
  snapshotPath?: string;
  createdAt: number;
  metadata?: string;
}

export class CheckpointManager {
  private db: Database.Database;
  private cwd: string;
  private isGitRepo: boolean = false;

  constructor(db: Database.Database, cwd: string) {
    this.db = db;
    this.cwd = cwd;
    this.checkGitRepo();
  }

  private async checkGitRepo(): Promise<void> {
    try {
      await fs.access(join(this.cwd, '.git'));
      this.isGitRepo = true;
    } catch {
      this.isGitRepo = false;
    }
  }

  async create(name: string, sessionId: string): Promise<Checkpoint> {
    const id = randomUUID();
    const now = Date.now();

    if (this.isGitRepo) {
      // Create git commit
      const gitRef = `horus-checkpoint-${id.slice(0, 8)}`;
      
      await this.runGit(['add', '-A']);
      await this.runGit(['commit', '-m', `[Horus Checkpoint] ${name}`, '--allow-empty']);
      await this.runGit(['tag', gitRef]);

      const checkpoint: Checkpoint = {
        id,
        sessionId,
        name,
        type: 'git',
        gitRef,
        createdAt: now,
      };

      this.saveCheckpoint(checkpoint);
      return checkpoint;
    } else {
      // Create file snapshot
      const snapshotPath = join(this.cwd, '.horus', 'snapshots', id);
      await this.createSnapshot(snapshotPath);

      const checkpoint: Checkpoint = {
        id,
        sessionId,
        name,
        type: 'snapshot',
        snapshotPath,
        createdAt: now,
      };

      this.saveCheckpoint(checkpoint);
      return checkpoint;
    }
  }

  async rollback(checkpointId?: string): Promise<boolean> {
    if (checkpointId) {
      return this.rollbackTo(checkpointId);
    }

    // Rollback to most recent checkpoint
    const checkpoint = this.getMostRecent();
    if (!checkpoint) {
      throw new Error('No checkpoints found');
    }

    return this.rollbackTo(checkpoint.id);
  }

  async rollbackTo(checkpointId: string): Promise<boolean> {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    if (checkpoint.type === 'git' && checkpoint.gitRef) {
      await this.runGit(['reset', '--hard', checkpoint.gitRef]);
      return true;
    } else if (checkpoint.type === 'snapshot' && checkpoint.snapshotPath) {
      await this.restoreSnapshot(checkpoint.snapshotPath);
      return true;
    }

    return false;
  }

  list(sessionId?: string): Checkpoint[] {
    let sql = 'SELECT * FROM checkpoints';
    const params: any[] = [];

    if (sessionId) {
      sql += ' WHERE session_id = ?';
      params.push(sessionId);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      type: row.type,
      gitRef: row.git_ref,
      snapshotPath: row.snapshot_path,
      createdAt: row.created_at,
      metadata: row.metadata,
    }));
  }

  getCheckpoint(id: string): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      type: row.type,
      gitRef: row.git_ref,
      snapshotPath: row.snapshot_path,
      createdAt: row.created_at,
      metadata: row.metadata,
    };
  }

  private getMostRecent(): Checkpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 1').get() as any;
    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      type: row.type,
      gitRef: row.git_ref,
      snapshotPath: row.snapshot_path,
      createdAt: row.created_at,
      metadata: row.metadata,
    };
  }

  private saveCheckpoint(checkpoint: Checkpoint): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, session_id, name, type, git_ref, snapshot_path, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      checkpoint.id,
      checkpoint.sessionId,
      checkpoint.name,
      checkpoint.type,
      checkpoint.gitRef || null,
      checkpoint.snapshotPath || null,
      checkpoint.createdAt,
      checkpoint.metadata || null
    );
  }

  private async createSnapshot(snapshotPath: string): Promise<void> {
    // Create snapshot directory
    await fs.mkdir(snapshotPath, { recursive: true });

    // Copy all files (respecting .gitignore would be better)
    const glob = await import('fast-glob');
    const files = await glob.default(['**/*', '!node_modules/**', '!.git/**', '!.horus/**'], {
      cwd: this.cwd,
      absolute: false,
      onlyFiles: true,
    });

    for (const file of files) {
      const src = join(this.cwd, file);
      const dest = join(snapshotPath, file);
      await fs.mkdir(join(dest, '..'), { recursive: true });
      await fs.copyFile(src, dest);
    }
  }

  private async restoreSnapshot(snapshotPath: string): Promise<void> {
    // Copy files back
    const glob = await import('fast-glob');
    const files = await glob.default(['**/*'], {
      cwd: snapshotPath,
      absolute: false,
      onlyFiles: true,
    });

    for (const file of files) {
      const src = join(snapshotPath, file);
      const dest = join(this.cwd, file);
      await fs.mkdir(join(dest, '..'), { recursive: true });
      await fs.copyFile(src, dest);
    }
  }

  private runGit(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: this.cwd, stdio: 'pipe' });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git command failed: git ${args.join(' ')}`));
        }
      });

      child.on('error', reject);
    });
  }
}

// SQL for checkpoints table
export const CHECKPOINT_SCHEMA = `
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'git' or 'snapshot'
  git_ref TEXT,
  snapshot_path TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
`;
