// Session metadata management for named sessions, tags, and export/import

import { promises as fs } from 'fs';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface SessionMetadata {
  id: string;
  name?: string;
  tags: string[];
  description?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  toolCallCount: number;
  status: 'active' | 'completed' | 'archived';
  summary?: string;
}

export interface SessionExport {
  metadata: SessionMetadata;
  messages: any[];
  episodes: any[];
  facts: any[];
  exportedAt: number;
  version: string;
}

export class SessionMetadataManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeTable();
  }

  private initializeTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_metadata (
        id TEXT PRIMARY KEY,
        name TEXT,
        tags TEXT,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_session_meta_name ON session_metadata(name);
      CREATE INDEX IF NOT EXISTS idx_session_meta_status ON session_metadata(status);
      CREATE INDEX IF NOT EXISTS idx_session_meta_updated ON session_metadata(updated_at DESC);
    `);
  }

  createMetadata(sessionId: string, name?: string, tags?: string[], description?: string): void {
    const now = Date.now();
    const tagString = tags?.join(',') || '';

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session_metadata 
      (id, name, tags, description, created_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `);

    stmt.run(sessionId, name || null, tagString, description || null, now, now);
  }

  updateMetadata(sessionId: string, updates: Partial<SessionMetadata>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?');
      values.push(updates.tags.join(','));
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(sessionId);

    const stmt = this.db.prepare(`
      UPDATE session_metadata SET ${fields.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);
  }

  getMetadata(sessionId: string): SessionMetadata | null {
    const row = this.db.prepare('SELECT * FROM session_metadata WHERE id = ?').get(sessionId) as any;
    if (!row) return null;

    return this.rowToMetadata(row);
  }

  findSessions(options?: { 
    status?: string; 
    tag?: string; 
    name?: string;
    limit?: number;
  }): SessionMetadata[] {
    let sql = 'SELECT * FROM session_metadata WHERE 1=1';
    const params: any[] = [];

    if (options?.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options?.tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%${options.tag}%`);
    }
    if (options?.name) {
      sql += ' AND name LIKE ?';
      params.push(`%${options.name}%`);
    }

    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToMetadata(row));
  }

  searchSessions(query: string): SessionMetadata[] {
    const sql = `
      SELECT * FROM session_metadata 
      WHERE name LIKE ? OR description LIKE ? OR summary LIKE ? OR tags LIKE ?
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    const pattern = `%${query}%`;
    const rows = this.db.prepare(sql).all(pattern, pattern, pattern, pattern) as any[];
    return rows.map(row => this.rowToMetadata(row));
  }

  archiveOldSessions(olderThanDays: number = 30): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(`
      UPDATE session_metadata 
      SET status = 'archived' 
      WHERE updated_at < ? AND status = 'active'
    `);
    const result = stmt.run(cutoff);
    return result.changes;
  }

  incrementMessageCount(sessionId: string): void {
    this.db.prepare(`
      UPDATE session_metadata 
      SET message_count = message_count + 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), sessionId);
  }

  incrementToolCallCount(sessionId: string): void {
    this.db.prepare(`
      UPDATE session_metadata 
      SET tool_call_count = tool_call_count + 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), sessionId);
  }

  exportSession(sessionId: string): SessionExport | null {
    const metadata = this.getMetadata(sessionId);
    if (!metadata) return null;

    // Get messages, episodes, facts from the database
    const messages = this.db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
    const episodes = this.db.prepare('SELECT * FROM episodes WHERE session_id = ?').all(sessionId);
    
    // For facts, we might want to include ones that were accessed during this session
    // For now, we'll skip facts as they're global

    return {
      metadata,
      messages,
      episodes,
      facts: [],
      exportedAt: Date.now(),
      version: '1.0.0',
    };
  }

  async exportToFile(sessionId: string, filepath: string): Promise<void> {
    const export_data = this.exportSession(sessionId);
    if (!export_data) throw new Error('Session not found');

    await fs.writeFile(filepath, JSON.stringify(export_data, null, 2), 'utf-8');
  }

  async importFromFile(filepath: string): Promise<string> {
    const content = await fs.readFile(filepath, 'utf-8');
    const data: SessionExport = JSON.parse(content);

    const newSessionId = randomUUID();

    // Import metadata
    this.createMetadata(
      newSessionId,
      `${data.metadata.name || 'Imported'} (copy)`,
      data.metadata.tags,
      data.metadata.description
    );

    // Import messages
    const msgStmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, created_at, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const msg of data.messages) {
      msgStmt.run(
        randomUUID(),
        newSessionId,
        msg.role,
        msg.content,
        msg.tool_calls || null,
        msg.tool_call_id || null,
        msg.created_at,
        msg.tokens || 0
      );
    }

    // Import episodes
    const epStmt = this.db.prepare(`
      INSERT INTO episodes (id, session_id, action_type, action_summary, context, action, outcome, outcome_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ep of data.episodes) {
      epStmt.run(
        randomUUID(),
        newSessionId,
        ep.action_type,
        ep.action_summary,
        ep.context,
        ep.action,
        ep.outcome,
        ep.outcome_type,
        ep.created_at
      );
    }

    return newSessionId;
  }

  private rowToMetadata(row: any): SessionMetadata {
    return {
      id: row.id,
      name: row.name,
      tags: row.tags ? row.tags.split(',').filter((t: string) => t) : [],
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      toolCallCount: row.tool_call_count,
      status: row.status,
      summary: row.summary,
    };
  }
}
