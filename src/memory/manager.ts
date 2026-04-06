import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { expandHomeDir } from '../utils/paths.js';
import {
  SCHEMA_SQL,
  Session,
  Message,
  Episode,
  Fact,
  FileIndex,
  CodeChunk,
  Checkpoint,
  SubagentTask,
  DocIndex,
  Pattern,
} from './schema.js';
import { CheckpointManager } from '../checkpoint.js';
import { SubagentManager, SubagentConfig } from '../subagent.js';
import {
  EmbeddingProvider,
  LocalEmbeddingModel,
  embeddingToBuffer,
  bufferToEmbedding,
} from './embedding.js';

export interface MemoryManagerConfig {
  dbPath: string;
  embeddingModel?: string;
  maxWorkingTokens?: number;
  recallThreshold?: number;
  maxRecalledMemories?: number;
}

export interface RecalledMemory {
  type: 'episode' | 'fact' | 'code' | 'file';
  id: string;
  content: string;
  relevance: number;
  source?: string;
  timestamp?: number;
  metadata?: any;
}

export class MemoryManager {
  private db: Database.Database;
  private embedder: EmbeddingProvider;
  private config: Required<MemoryManagerConfig>;
  private currentSession: Session | null = null;
  private workingTokens: number = 0;
  public checkpointManager: CheckpointManager;
  public subagentManager?: SubagentManager;

  constructor(config: MemoryManagerConfig, subagentConfig?: SubagentConfig) {
    this.config = {
      maxWorkingTokens: 50000,
      recallThreshold: 0.7,
      maxRecalledMemories: 10,
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      ...config,
    };

    // Ensure directory exists
    const dbPath = expandHomeDir(this.config.dbPath);
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);

    // Initialize embedder
    this.embedder = new LocalEmbeddingModel(this.config.embeddingModel);

    // Initialize checkpoint manager (will be set up when session starts)
    this.checkpointManager = new CheckpointManager(this.db, '');

    // Initialize subagent manager if config provided
    if (subagentConfig) {
      this.subagentManager = new SubagentManager(subagentConfig);
    }
  }

  async initialize(): Promise<void> {
    await this.embedder.initialize();
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async startSession(cwd: string, resumeId?: string): Promise<Session> {
    if (resumeId) {
      const session = this.getSession(resumeId);
      if (session) {
        this.currentSession = session;
        this.workingTokens = this.calculateSessionTokens(resumeId);
        return session;
      }
    }

    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      cwd,
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, created_at, updated_at, cwd)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(session.id, session.createdAt, session.updatedAt, session.cwd);

    this.currentSession = session;
    this.workingTokens = 0;

    // Update checkpoint manager with cwd
    this.checkpointManager = new CheckpointManager(this.db, cwd);

    return session;
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cwd: row.cwd,
      summary: row.summary,
    };
  }

  async endSession(summary?: string): Promise<void> {
    if (!this.currentSession) return;

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET updated_at = ?, summary = COALESCE(?, summary)
      WHERE id = ?
    `);
    stmt.run(now, summary || null, this.currentSession.id);

    // Generate summary if not provided
    if (!summary) {
      const autoSummary = await this.generateSessionSummary();
      this.db
        .prepare('UPDATE sessions SET summary = ? WHERE id = ?')
        .run(autoSummary, this.currentSession.id);
    }

    this.currentSession = null;
    this.workingTokens = 0;
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  // ═══════════════════════════════════════════════════════════
  // WORKING MEMORY (Messages)
  // ═══════════════════════════════════════════════════════════

  async addMessage(msg: Omit<Message, 'id' | 'sessionId' | 'createdAt' | 'tokens'>): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const tokens = this.estimateTokens(msg.content || '');

    // Check if we need to compress
    while (this.workingTokens + tokens > this.config.maxWorkingTokens) {
      await this.compressOldestMessages();
    }

    const message: Message = {
      id: randomUUID(),
      sessionId: this.currentSession.id,
      role: msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls,
      toolCallId: msg.toolCallId,
      createdAt: Date.now(),
      tokens,
    };

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, created_at, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      message.toolCalls || null,
      message.toolCallId || null,
      message.createdAt,
      message.tokens
    );

    this.workingTokens += tokens;
  }

  getMessages(sessionId?: string): Message[] {
    const sid = sessionId || this.currentSession?.id;
    if (!sid) return [];

    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sid) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      createdAt: row.created_at,
      tokens: row.tokens,
    }));
  }

  getLastMessage(): Message | null {
    if (!this.currentSession) return null;

    const row = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(this.currentSession.id) as any;

    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      createdAt: row.created_at,
      tokens: row.tokens,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // EPISODIC MEMORY
  // ═══════════════════════════════════════════════════════════

  async recordEpisode(
    actionType: string,
    context: string,
    action: string,
    outcomeType: 'success' | 'error' | 'partial',
    outcome: string
  ): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const actionSummary = `${actionType}: ${action.substring(0, 100)}`;
    const embedding = await this.embedder.embed(`${actionSummary} ${context} ${outcome}`);

    const episode: Episode = {
      id: randomUUID(),
      sessionId: this.currentSession.id,
      actionType,
      actionSummary,
      context,
      action,
      outcome,
      outcomeType,
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO episodes (id, session_id, action_type, action_summary, context, action, outcome, outcome_type, created_at, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      episode.id,
      episode.sessionId,
      episode.actionType,
      episode.actionSummary,
      episode.context,
      episode.action,
      episode.outcome,
      episode.outcomeType,
      episode.createdAt,
      embeddingToBuffer(embedding)
    );
  }

  getEpisodes(sessionId?: string, limit: number = 100): Episode[] {
    const sid = sessionId || this.currentSession?.id;
    if (!sid) return [];

    const rows = this.db
      .prepare('SELECT * FROM episodes WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(sid, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      actionType: row.action_type,
      actionSummary: row.action_summary,
      context: row.context,
      action: row.action,
      outcome: row.outcome,
      outcomeType: row.outcome_type,
      createdAt: row.created_at,
      embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // SEMANTIC MEMORY (Facts)
  // ═══════════════════════════════════════════════════════════

  async storeFact(
    category: string,
    fact: string,
    source?: string,
    confidence: number = 1.0
  ): Promise<void> {
    const embedding = await this.embedder.embed(fact);
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO facts (id, category, fact, source, confidence, created_at, last_accessed, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      randomUUID(),
      category,
      fact,
      source || null,
      confidence,
      now,
      now,
      embeddingToBuffer(embedding)
    );
  }

  getFacts(category?: string, limit: number = 100): Fact[] {
    let sql = 'SELECT * FROM facts';
    const params: any[] = [];

    if (category) {
      sql += ' WHERE category = ?';
      params.push(category);
    }

    sql += ' ORDER BY confidence DESC, last_accessed DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      category: row.category,
      fact: row.fact,
      source: row.source,
      confidence: row.confidence,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
    }));
  }

  async extractAndStoreFacts(text: string, source: string): Promise<void> {
    // Simple extraction: split into sentences, embed each
    // In a more sophisticated version, we might use LLM to extract facts
    const sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 500);

    for (const sentence of sentences.slice(0, 5)) {
      await this.storeFact('extracted', sentence, source, 0.8);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RECALL (Semantic Search)
  // ═══════════════════════════════════════════════════════════

  async recall(query: string, limit?: number): Promise<RecalledMemory[]> {
    const k = limit || this.config.maxRecalledMemories;
    const queryEmbedding = await this.embedder.embed(query);

    // Search all memory types in parallel
    const [episodes, facts, files, chunks] = await Promise.all([
      this.recallEpisodes(queryEmbedding, k),
      this.recallFacts(queryEmbedding, k),
      this.recallFiles(queryEmbedding, Math.floor(k / 2)),
      this.recallChunks(queryEmbedding, k),
    ]);

    // Combine and sort by relevance
    const all: RecalledMemory[] = [
      ...episodes,
      ...facts,
      ...files,
      ...chunks,
    ];

    all.sort((a, b) => b.relevance - a.relevance);

    // Log access
    this.logMemoryAccess(query, all.slice(0, k));

    return all.slice(0, k);
  }

  private async recallEpisodes(queryEmbedding: Float32Array, k: number): Promise<RecalledMemory[]> {
    // Get all episodes with embeddings
    const rows = this.db
      .prepare('SELECT id, action_summary, context, outcome, created_at, embedding FROM episodes ORDER BY created_at DESC LIMIT 1000')
      .all() as any[];

    const candidates = rows
      .filter(row => row.embedding)
      .map(row => ({
        id: row.id,
        embedding: bufferToEmbedding(row.embedding),
        metadata: {
          summary: row.action_summary,
          context: row.context,
          outcome: row.outcome,
          timestamp: row.created_at,
        },
      }));

    const topK = this.embedder.findTopK(queryEmbedding, candidates, k);

    return topK
      .filter(item => item.score >= this.config.recallThreshold)
      .map(item => ({
        type: 'episode',
        id: item.id,
        content: `${item.metadata.summary}\nContext: ${item.metadata.context}\nOutcome: ${item.metadata.outcome}`,
        relevance: item.score,
        timestamp: item.metadata.timestamp,
        metadata: item.metadata,
      }));
  }

  private async recallFacts(queryEmbedding: Float32Array, k: number): Promise<RecalledMemory[]> {
    const rows = this.db
      .prepare('SELECT id, fact, category, source, confidence, created_at, embedding FROM facts')
      .all() as any[];

    const candidates = rows
      .filter(row => row.embedding)
      .map(row => ({
        id: row.id,
        embedding: bufferToEmbedding(row.embedding),
        metadata: {
          fact: row.fact,
          category: row.category,
          source: row.source,
          confidence: row.confidence,
          timestamp: row.created_at,
        },
      }));

    const topK = this.embedder.findTopK(queryEmbedding, candidates, k);

    // Update access counts
    const updateStmt = this.db.prepare('UPDATE facts SET access_count = access_count + 1, last_accessed = ? WHERE id = ?');
    const now = Date.now();
    for (const item of topK) {
      updateStmt.run(now, item.id);
    }

    return topK
      .filter(item => item.score >= this.config.recallThreshold)
      .map(item => ({
        type: 'fact',
        id: item.id,
        content: item.metadata.fact,
        relevance: item.score,
        source: item.metadata.source,
        timestamp: item.metadata.timestamp,
        metadata: item.metadata,
      }));
  }

  private async recallFiles(queryEmbedding: Float32Array, k: number): Promise<RecalledMemory[]> {
    const rows = this.db
      .prepare('SELECT id, path, summary, outline, indexed_at, embedding FROM files WHERE embedding IS NOT NULL')
      .all() as any[];

    const candidates = rows.map(row => ({
      id: row.id,
      embedding: bufferToEmbedding(row.embedding),
      metadata: {
        path: row.path,
        summary: row.summary,
        outline: row.outline,
        timestamp: row.indexed_at,
      },
    }));

    const topK = this.embedder.findTopK(queryEmbedding, candidates, k);

    return topK
      .filter(item => item.score >= this.config.recallThreshold)
      .map(item => ({
        type: 'file',
        id: item.id,
        content: `${item.metadata.path}\n${item.metadata.summary || ''}\n${item.metadata.outline || ''}`,
        relevance: item.score,
        source: item.metadata.path,
        timestamp: item.metadata.timestamp,
        metadata: item.metadata,
      }));
  }

  private async recallChunks(queryEmbedding: Float32Array, k: number): Promise<RecalledMemory[]> {
    const rows = this.db.prepare(`
      SELECT c.id, c.content, c.chunk_type, c.name, c.start_line, c.end_line, f.path, c.embedding
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.embedding IS NOT NULL
    `).all() as any[];

    const candidates = rows.map(row => ({
      id: row.id,
      embedding: bufferToEmbedding(row.embedding),
      metadata: {
        content: row.content,
        chunkType: row.chunk_type,
        name: row.name,
        startLine: row.start_line,
        endLine: row.end_line,
        path: row.path,
      },
    }));

    const topK = this.embedder.findTopK(queryEmbedding, candidates, k);

    return topK
      .filter(item => item.score >= this.config.recallThreshold)
      .map(item => ({
        type: 'code',
        id: item.id,
        content: `${item.metadata.path}:${item.metadata.startLine}-${item.metadata.endLine}\n${item.metadata.content}`,
        relevance: item.score,
        source: item.metadata.path,
        metadata: item.metadata,
      }));
  }

  private logMemoryAccess(query: string, memories: RecalledMemory[]): void {
    if (!this.currentSession) return;

    const stmt = this.db.prepare(`
      INSERT INTO memory_log (session_id, query, memory_type, memory_id, relevance, used, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    for (const mem of memories) {
      stmt.run(this.currentSession.id, query, mem.type, mem.id, mem.relevance, 1, now);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CODEBASE INDEXING
  // ═══════════════════════════════════════════════════════════

  async indexWorkspace(rootPath: string): Promise<{ files: number; chunks: number }> {
    const glob = await import('fast-glob');
    const paths = await glob.default(['**/*.{ts,js,tsx,jsx,py,rs,go,java,rb}'], {
      cwd: rootPath,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      absolute: true,
    });

    let fileCount = 0;
    let chunkCount = 0;

    for (const filePath of paths.slice(0, 1000)) { // Limit to 1000 files for now
      try {
        const { promises: fs } = await import('fs');
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf-8');

        const result = await this.indexFile(filePath, content, stats.mtimeMs, stats.size);
        fileCount++;
        chunkCount += result.chunks;
      } catch (e) {
        // Skip files we can't read
      }
    }

    return { files: fileCount, chunks: chunkCount };
  }

  async indexFile(
    filePath: string,
    content: string,
    lastModified: number,
    size: number
  ): Promise<{ file: FileIndex; chunks: number }> {
    const { createHash } = await import('crypto');
    const contentHash = createHash('md5').update(content).digest('hex');

    // Check if file already indexed and unchanged
    const existing = this.db.prepare('SELECT id, content_hash FROM files WHERE path = ?').get(filePath) as any;
    if (existing && existing.content_hash === contentHash) {
      return { file: this.getFile(existing.id)!, chunks: 0 };
    }

    // Detect language
    const language = this.detectLanguage(filePath);

    // Extract chunks (simple approach: functions and classes)
    const chunks = this.extractChunks(content, language);

    // Generate file embedding from first 2000 chars
    const fileEmbedding = await this.embedder.embed(content.substring(0, 2000));

    const fileId = existing?.id || randomUUID();
    const file: FileIndex = {
      id: fileId,
      path: filePath,
      contentHash,
      lastModified,
      size,
      language,
      outline: JSON.stringify(chunks.map(c => ({ type: c.chunkType, name: c.name }))),
      indexedAt: Date.now(),
    };

    // Insert or update file
    const fileStmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (id, path, content_hash, last_modified, size, language, outline, indexed_at, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    fileStmt.run(
      file.id,
      file.path,
      file.contentHash,
      file.lastModified,
      file.size,
      file.language,
      file.outline,
      file.indexedAt,
      embeddingToBuffer(fileEmbedding)
    );

    // Delete old chunks
    this.db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);

    // Insert new chunks with embeddings
    const chunkStmt = this.db.prepare(`
      INSERT INTO chunks (id, file_id, start_line, end_line, content, chunk_type, name, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let chunkCount = 0;
    for (const chunk of chunks) {
      const chunkEmbedding = await this.embedder.embed(chunk.content);
      chunkStmt.run(
        randomUUID(),
        fileId,
        chunk.startLine,
        chunk.endLine,
        chunk.content,
        chunk.chunkType,
        chunk.name,
        embeddingToBuffer(chunkEmbedding)
      );
      chunkCount++;
    }

    return { file, chunks: chunkCount };
  }

  getFile(id: string): FileIndex | null {
    const row = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      contentHash: row.content_hash,
      lastModified: row.last_modified,
      size: row.size,
      language: row.language,
      outline: row.outline,
      summary: row.summary,
      indexedAt: row.indexed_at,
      embedding: row.embedding ? bufferToEmbedding(row.embedding) : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  private async compressOldestMessages(): Promise<void> {
    if (!this.currentSession) return;

    // Get oldest 4 non-system messages
    const rows = this.db
      .prepare(`
        SELECT * FROM messages 
        WHERE session_id = ? AND role != 'system' 
        ORDER BY created_at ASC 
        LIMIT 4
      `)
      .all(this.currentSession.id) as any[];

    if (rows.length < 2) return; // Can't compress single message

    // Summarize (in real implementation, use LLM)
    const content = rows.map(r => `${r.role}: ${r.content}`).join('\n');
    const summary = `[Summarized ${rows.length} messages]`;

    // Delete old messages
    const deleteStmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
    for (const row of rows) {
      deleteStmt.run(row.id);
      this.workingTokens -= row.tokens;
    }

    // Add summary message
    await this.addMessage({
      role: 'system',
      content: summary,
    });
  }

  private calculateSessionTokens(sessionId: string): number {
    const row = this.db
      .prepare('SELECT SUM(tokens) as total FROM messages WHERE session_id = ?')
      .get(sessionId) as any;
    return row?.total || 0;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 4 characters per token
    return Math.ceil(text.length / 4);
  }

  private async generateSessionSummary(): Promise<string> {
    // In a real implementation, use LLM to summarize
    const episodes = this.getEpisodes(undefined, 10);
    return `Session with ${episodes.length} actions`;
  }

  private detectLanguage(filePath: string): string | undefined {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.rs')) return 'rust';
    if (filePath.endsWith('.go')) return 'go';
    if (filePath.endsWith('.java')) return 'java';
    if (filePath.endsWith('.rb')) return 'ruby';
    return undefined;
  }

  private extractChunks(
    content: string,
    language?: string
  ): Array<{ startLine: number; endLine: number; content: string; chunkType: string; name?: string }> {
    const lines = content.split('\n');
    const chunks: Array<{ startLine: number; endLine: number; content: string; chunkType: string; name?: string }> = [];

    // Simple regex-based extraction
    const patterns: Array<{ regex: RegExp; type: string }> = [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)/, type: 'class' },
      { regex: /^(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*[=:]/, type: 'const' },
      { regex: /^(?:export\s+)?(?:async\s+)?(\w+)\s*[=:]\s*(?:async\s*)?\(/, type: 'function' },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          // Find end of chunk (next empty line or closing brace at same indent)
          let endLine = i + 1;
          const baseIndent = line.match(/^(\s*)/)?.[1].length || 0;

          for (let j = i + 1; j < lines.length; j++) {
            const currentLine = lines[j];
            const currentIndent = currentLine.match(/^(\s*)/)?.[1].length || 0;

            if (currentLine.trim() === '' || (currentIndent <= baseIndent && currentLine.trim().startsWith('}'))) {
              endLine = j;
              break;
            }
            endLine = j;
          }

          chunks.push({
            startLine: i + 1,
            endLine: endLine + 1,
            content: lines.slice(i, endLine + 1).join('\n'),
            chunkType: pattern.type,
            name: match[1],
          });
          break;
        }
      }
    }

    return chunks.slice(0, 50); // Limit chunks per file
  }

  close(): void {
    this.db.close();
  }
}
