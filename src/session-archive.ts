// Session archiving - compress and archive old sessions

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import Database from 'better-sqlite3';

export interface ArchiveOptions {
  olderThanDays: number;
  compress: boolean;
  deleteOriginal: boolean;
  archiveDir: string;
}

export class SessionArchiver {
  private db: Database.Database;
  private options: ArchiveOptions;

  constructor(db: Database.Database, options?: Partial<ArchiveOptions>) {
    this.db = db;
    this.options = {
      olderThanDays: 30,
      compress: true,
      deleteOriginal: false,
      archiveDir: join(homedir(), '.horus', 'archives'),
      ...options,
    };
  }

  async archiveOldSessions(): Promise<{
    archived: number;
    errors: string[];
    bytesFreed: number;
  }> {
    const result = { archived: 0, errors: [] as string[], bytesFreed: 0 };

    // Ensure archive directory exists
    await fs.mkdir(this.options.archiveDir, { recursive: true });

    // Find old sessions
    const cutoff = Date.now() - (this.options.olderThanDays * 24 * 60 * 60 * 1000);
    const sessions = this.db.prepare(`
      SELECT s.id, s.created_at, s.updated_at, COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON s.id = m.session_id
      WHERE s.updated_at < ?
      GROUP BY s.id
    `).all(cutoff) as any[];

    for (const session of sessions) {
      try {
        const archiveResult = await this.archiveSession(session.id);
        
        if (archiveResult.success) {
          result.archived++;
          result.bytesFreed += archiveResult.bytes;

          if (this.options.deleteOriginal) {
            await this.deleteSession(session.id);
          }
        } else {
          result.errors.push(`Session ${session.id}: ${archiveResult.error}`);
        }
      } catch (error) {
        result.errors.push(`Session ${session.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    return result;
  }

  private async archiveSession(sessionId: string): Promise<{ success: boolean; bytes: number; error?: string }> {
    const exportData = this.exportSessionData(sessionId);
    
    if (!exportData) {
      return { success: false, bytes: 0, error: 'Session not found' };
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `session-${sessionId.slice(0, 8)}-${timestamp}.json`;
    const filepath = join(this.options.archiveDir, filename);

    // Write JSON
    const json = JSON.stringify(exportData, null, 2);
    await fs.writeFile(filepath, json, 'utf-8');

    let bytes = json.length;

    // Compress if enabled
    if (this.options.compress) {
      const gzippedPath = `${filepath}.gz`;
      await this.compressFile(filepath, gzippedPath);
      await fs.unlink(filepath);
      
      const stats = await fs.stat(gzippedPath);
      bytes = stats.size;
    }

    // Update session status to archived
    this.db.prepare(`
      UPDATE sessions SET summary = COALESCE(summary, '') || ' [ARCHIVED]' WHERE id = ?
    `).run(sessionId);

    return { success: true, bytes };
  }

  private exportSessionData(sessionId: string): any {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const messages = this.db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
    const episodes = this.db.prepare('SELECT * FROM episodes WHERE session_id = ?').all(sessionId);
    const metadata = this.db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId);

    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      session,
      messages,
      episodes,
      metadata,
    };
  }

  private async compressFile(input: string, output: string): Promise<void> {
    const source = createReadStream(input);
    const destination = createWriteStream(output);
    const gzip = createGzip();

    await pipeline(source, gzip, destination);
  }

  private async deleteSession(sessionId: string): Promise<void> {
    // Delete related data
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM episodes WHERE session_id = ?').run(sessionId);
    this.db.prepare('DELETE FROM session_metadata WHERE id = ?').run(sessionId);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  async restoreSession(archivePath: string): Promise<string | null> {
    try {
      // Decompress if needed
      let content: string;
      
      if (archivePath.endsWith('.gz')) {
        const { createGunzip } = await import('zlib');
        const { promisify } = await import('util');
        const gunzip = promisify(createGunzip);
        
        const buffer = await fs.readFile(archivePath);
        const decompressed = await gunzip(buffer);
        content = decompressed.toString('utf-8');
      } else {
        content = await fs.readFile(archivePath, 'utf-8');
      }

      const data = JSON.parse(content);
      const newSessionId = crypto.randomUUID();

      // Restore session
      this.db.prepare(`
        INSERT INTO sessions (id, created_at, updated_at, cwd, summary)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        newSessionId,
        Date.now(),
        Date.now(),
        data.session.cwd,
        `${data.session.summary || ''} [RESTORED]`.trim()
      );

      // Restore messages
      const msgStmt = this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, created_at, tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const msg of data.messages) {
        msgStmt.run(
          crypto.randomUUID(),
          newSessionId,
          msg.role,
          msg.content,
          msg.tool_calls || null,
          msg.tool_call_id || null,
          Date.now(),
          msg.tokens || 0
        );
      }

      return newSessionId;
    } catch (error) {
      console.error('Failed to restore session:', error);
      return null;
    }
  }

  async listArchives(): Promise<{ filename: string; date: Date; size: number }[]> {
    try {
      const files = await fs.readdir(this.options.archiveDir);
      const archives: { filename: string; date: Date; size: number }[] = [];

      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.json.gz')) {
          const filepath = join(this.options.archiveDir, file);
          const stats = await fs.stat(filepath);
          
          archives.push({
            filename: file,
            date: stats.mtime,
            size: stats.size,
          });
        }
      }

      return archives.sort((a, b) => b.date.getTime() - a.date.getTime());
    } catch {
      return [];
    }
  }
}

// Need to import crypto for restore
import { randomUUID as crypto } from 'crypto';
