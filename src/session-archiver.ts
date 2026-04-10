// Session Archiver - Compress old sessions to save space
import Database from 'better-sqlite3';
import { createGzip } from 'zlib';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { createReadStream, createWriteStream, unlinkSync } from 'fs';

import { join, dirname } from 'path';

const pipelineAsync = promisify(pipeline);

export interface ArchiveResult {
  archived: number;
  savedMB: number;
}

export interface ArchivedSession {
  id: string;
  originalId: string;
  name?: string;
  archivedAt: Date;
  compressedSize: number;
  originalSize: number;
  path: string;
}

export class SessionArchiver {
  private db: Database.Database | null = null;
  private archiveDir: string;

  constructor(
    dbPath: string,
    archiveDir: string = join(dirname(dbPath), 'archives')
  ) {
    this.archiveDir = archiveDir;
  }

  async initialize(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    const { dirname } = await import('path');
    await mkdir(dirname(this.archiveDir), { recursive: true });
    
    const { default: Database } = await import('better-sqlite3');
    this.db = new Database(join(dirname(this.archiveDir), 'memory.db'));
    
    await mkdir(this.archiveDir, { recursive: true });
    this.initTables();
  }

  private initTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS archived_sessions (
        id TEXT PRIMARY KEY,
        original_id TEXT UNIQUE NOT NULL,
        name TEXT,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        compressed_size INTEGER,
        original_size INTEGER,
        archive_path TEXT NOT NULL,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_archived_sessions_date 
        ON archived_sessions(archived_at);
    `);
  }

  async archiveOldSessions(days: number = 30, dryRun: boolean = false): Promise<ArchiveResult> {
    if (!this.db) throw new Error('Not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const sessionsToArchive = this.db.prepare(`
      SELECT s.*, COUNT(e.id) as episode_count
      FROM sessions s
      LEFT JOIN episodes e ON e.session_id = s.id
      WHERE s.updated_at < ?
        AND s.id NOT IN (SELECT original_id FROM archived_sessions)
      GROUP BY s.id
    `).all(cutoffDate.toISOString()) as any[];

    if (dryRun) {
      const estimatedSize = sessionsToArchive.reduce((sum, s) => {
        return sum + (s.episode_count * 1024); // Rough estimate: 1KB per episode
      }, 0);
      return {
        archived: sessionsToArchive.length,
        savedMB: estimatedSize / (1024 * 1024),
      };
    }

    let archived = 0;
    let totalSavedBytes = 0;

    for (const session of sessionsToArchive) {
      const result = await this.archiveSession(session);
      if (result) {
        archived++;
        totalSavedBytes += result.savedBytes;
      }
    }

    return {
      archived,
      savedMB: totalSavedBytes / (1024 * 1024),
    };
  }

  private async archiveSession(session: any): Promise<{ savedBytes: number } | null> {
    if (!this.db) return null;

    const archiveId = `arch_${Date.now()}_${session.id.slice(0, 8)}`;
    const archivePath = join(this.archiveDir, `${archiveId}.json.gz`);

    // Gather all session data
    const episodes = this.db.prepare(
      'SELECT * FROM episodes WHERE session_id = ?'
    ).all(session.id);

    const checkpointer = this.db.prepare(
      'SELECT * FROM checkpoints WHERE session_id = ?'
    ).all(session.id);

    const archiveData = {
      session: {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        created_at: session.created_at,
        updated_at: session.updated_at,
        summary: session.summary,
      },
      episodes,
      checkpoints: checkpointer,
      archived_at: new Date().toISOString(),
    };

    const jsonData = JSON.stringify(archiveData, null, 2);
    const originalSize = Buffer.byteLength(jsonData, 'utf8');

    // Write and compress
    const tempPath = `${archivePath}.tmp`;
    await Bun.write(tempPath, jsonData);
    
    // Compress using gzip
    const gzip = createGzip({ level: 9 });
    const source = createReadStream(tempPath);
    const destination = createWriteStream(archivePath);
    
    await pipelineAsync(source, gzip, destination);
    unlinkSync(tempPath);

    // Get compressed size
    const stats = await import('fs/promises').then(fs => fs.stat(archivePath));
    const compressedSize = stats.size;

    // Record archive
    this.db.prepare(`
      INSERT INTO archived_sessions 
        (id, original_id, name, compressed_size, original_size, archive_path, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      archiveId,
      session.id,
      session.name,
      compressedSize,
      originalSize,
      archivePath,
      JSON.stringify({ episodeCount: episodes.length })
    );

    // Delete original data
    this.db.prepare('DELETE FROM episodes WHERE session_id = ?').run(session.id);
    this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?').run(session.id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);

    return { savedBytes: originalSize - compressedSize };
  }

  async restoreSession(archiveId: string): Promise<boolean> {
    if (!this.db) throw new Error('Not initialized');

    const archive = this.db.prepare(
      'SELECT * FROM archived_sessions WHERE id = ?'
    ).get(archiveId) as any;

    if (!archive) return false;

    // Decompress and restore
    const gunzip = (await import('zlib')).createGunzip();
    const source = createReadStream(archive.archive_path);
    
    const chunks: Buffer[] = [];
    for await (const chunk of source.pipe(gunzip)) {
      chunks.push(chunk);
    }
    
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    // Restore session
    this.db.prepare(`
      INSERT INTO sessions (id, name, cwd, created_at, updated_at, summary, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.session.id,
      data.session.name,
      data.session.cwd,
      data.session.created_at,
      data.session.updated_at,
      data.session.summary,
      JSON.stringify({ restoredFrom: archiveId })
    );

    // Restore episodes
    const insertEpisode = this.db.prepare(`
      INSERT INTO episodes (id, session_id, tool_name, input, output, embedding, timestamp, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ep of data.episodes) {
      insertEpisode.run(
        ep.id,
        ep.session_id,
        ep.tool_name,
        ep.input,
        ep.output,
        ep.embedding,
        ep.timestamp,
        ep.tokens
      );
    }

    // Remove archive record and file
    this.db.prepare('DELETE FROM archived_sessions WHERE id = ?').run(archiveId);
    unlinkSync(archive.archive_path);

    return true;
  }

  listArchives(): ArchivedSession[] {
    if (!this.db) throw new Error('Not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM archived_sessions ORDER BY archived_at DESC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      originalId: r.original_id,
      name: r.name,
      archivedAt: new Date(r.archived_at),
      compressedSize: r.compressed_size,
      originalSize: r.original_size,
      path: r.archive_path,
    }));
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
