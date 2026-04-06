// HORUS MEMORY ARCHITECTURE v2.0 - Four-Tier Memory Manager
// CoALA-compliant with agentic self-management

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// TYPES
// ============================================================================

export type MemoryTier = 'working' | 'episodic' | 'semantic' | 'archival';
export type MemoryType = 'fact' | 'preference' | 'skill' | 'code_pattern' | 'bugfix' | 'architecture';
export type RelationType = 'fixes' | 'depends_on' | 'related_to' | 'caused_by' | 'implements' | 'references' | 'contains';
export type RetrievalMethod = 'vector' | 'lexical' | 'temporal' | 'entity' | 'direct';

export interface EpisodicMemory {
  id?: number;
  sessionId: string;
  timestamp: number;
  turnNumber: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCalls?: any[];
  toolResults?: any[];
  checkpointRef?: string;
  summary?: string;
  metadata?: Record<string, any>;
  importanceScore?: number;
}

export interface SemanticMemory {
  id?: number;
  memoryType: MemoryType;
  createdAt: number;
  updatedAt: number;
  lastAccessed: number;
  accessCount: number;
  importanceScore: number;
  content: string;
  context?: {
    relatedFiles?: string[];
    project?: string;
    tags?: string[];
    entities?: string[];
  };
  embedding?: number[];
  compressionLevel?: number;
}

export interface WorkingMemoryPin {
  id?: number;
  sessionId: string;
  filePath: string;
  pinnedAt: number;
  priority: number;
  contentSnapshot?: string;
}

export interface EntityRelation {
  id?: number;
  sourceId: string;
  sourceType: 'episodic' | 'semantic';
  targetId: string;
  targetType: 'episodic' | 'semantic';
  relationType: RelationType;
  strengthScore: number;
  createdAt: number;
}

export interface RetrievalResult {
  id: string;
  content: string;
  tier: MemoryTier;
  relevanceScore: number;
  metadata: Record<string, any>;
  timestamp?: number;
  channelScores: Record<RetrievalMethod, number>;
}

export interface MemoryConfig {
  dbPath: string;
  embeddingDimension?: number; // 384 for MiniLM
  workingMemoryTokens?: number; // 200k default
  recallMaxAgeDays?: number; // 30 days
  consolidationIntervalHours?: number; // 24
}

// ============================================================================
// MEMORY MANAGER v2
// ============================================================================

export class MemoryManagerV2 {
  private db: Database.Database | null = null;
  private config: MemoryConfig;
  private embeddingDimension: number;

  constructor(config: MemoryConfig) {
    this.config = {
      embeddingDimension: 384,
      workingMemoryTokens: 200000,
      recallMaxAgeDays: 30,
      consolidationIntervalHours: 24,
      ...config,
    };
    this.embeddingDimension = this.config.embeddingDimension!;
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    const { mkdir } = await import('fs/promises');
    await mkdir(dirname(this.config.dbPath), { recursive: true });

    // Open database
    this.db = new Database(this.config.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Load sqlite-vec extension
    try {
      this.db.loadExtension('vec0');
    } catch (e) {
      // Extension might be loaded differently on some systems
      console.warn('Could not load vec0 extension, attempting alternative...');
      try {
        this.db.loadExtension('libvec0');
      } catch (e2) {
        console.warn('sqlite-vec extension not available, vector search will use fallback');
      }
    }

    // Initialize schema
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);

    console.log('✅ Memory v2.0 initialized');
  }

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  createSession(sessionId: string, workspacePath: string, metadata?: Record<string, any>): void {
    if (!this.db) throw new Error('Not initialized');
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT INTO sessions (session_id, created_at, updated_at, workspace_path, status, metadata)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(sessionId, now, now, workspacePath, JSON.stringify(metadata || {}));
  }

  getSession(sessionId: string): any | null {
    if (!this.db) throw new Error('Not initialized');
    return this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  }

  updateSession(sessionId: string, updates: Partial<{ status: string; estimatedTokens: number; metadata: Record<string, any> }>): void {
    if (!this.db) throw new Error('Not initialized');
    const now = Math.floor(Date.now() / 1000);
    
    const sets: string[] = ['updated_at = ?'];
    const values: any[] = [now];
    
    if (updates.status) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.estimatedTokens !== undefined) {
      sets.push('estimated_tokens = ?');
      values.push(updates.estimatedTokens);
    }
    if (updates.metadata) {
      sets.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    
    values.push(sessionId);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = ?`).run(...values);
  }

  // ==========================================================================
  // EPISODIC MEMORY (Tier 2)
  // ==========================================================================

  storeEpisodic(memory: EpisodicMemory): number {
    if (!this.db) throw new Error('Not initialized');
    
    const result = this.db.prepare(`
      INSERT INTO episodic_memory 
        (session_id, timestamp, turn_number, role, content, tool_calls, tool_results, 
         checkpoint_ref, summary, metadata, importance_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.sessionId,
      memory.timestamp,
      memory.turnNumber,
      memory.role,
      memory.content,
      memory.toolCalls ? JSON.stringify(memory.toolCalls) : null,
      memory.toolResults ? JSON.stringify(memory.toolResults) : null,
      memory.checkpointRef || null,
      memory.summary || null,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
      memory.importanceScore || 5.0
    );

    return Number(result.lastInsertRowid);
  }

  storeEpisodicWithEmbedding(memory: EpisodicMemory, embedding: number[]): number {
    const episodicId = this.storeEpisodic(memory);
    
    if (this.db) {
      // Store embedding
      this.db.prepare(`
        INSERT INTO episodic_embeddings (embedding, episodic_id, session_id, turn_number)
        VALUES (?, ?, ?, ?)
      `).run(
        JSON.stringify(embedding),
        episodicId,
        memory.sessionId,
        memory.turnNumber
      );
    }
    
    return episodicId;
  }

  getRecentEpisodic(sessionId: string, limit: number = 50): EpisodicMemory[] {
    if (!this.db) throw new Error('Not initialized');
    
    const rows = this.db.prepare(`
      SELECT * FROM episodic_memory 
      WHERE session_id = ? 
      ORDER BY turn_number DESC 
      LIMIT ?
    `).all(sessionId, limit) as any[];

    return rows.map(r => this.rowToEpisodic(r));
  }

  // ==========================================================================
  // SEMANTIC MEMORY (Tier 3)
  // ==========================================================================

  storeSemantic(memory: SemanticMemory): number {
    if (!this.db) throw new Error('Not initialized');
    const now = Math.floor(Date.now() / 1000);
    
    const result = this.db.prepare(`
      INSERT INTO semantic_memory 
        (memory_type, created_at, updated_at, last_accessed, access_count,
         importance_score, content, context, compression_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.memoryType,
      memory.createdAt || now,
      memory.updatedAt || now,
      memory.lastAccessed || now,
      memory.accessCount || 1,
      memory.importanceScore,
      memory.content,
      memory.context ? JSON.stringify(memory.context) : null,
      memory.compressionLevel || 0
    );

    return Number(result.lastInsertRowid);
  }

  storeSemanticWithEmbedding(memory: SemanticMemory, embedding: number[]): number {
    const memoryId = this.storeSemantic(memory);
    
    if (this.db && embedding.length === this.embeddingDimension) {
      // Calculate content hash for deduplication
      const crypto = require('crypto');
      const contentHash = crypto.createHash('md5').update(memory.content).digest('hex');
      
      this.db.prepare(`
        INSERT INTO semantic_embeddings (embedding, memory_id, content_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run(
        JSON.stringify(embedding),
        memoryId,
        contentHash,
        Math.floor(Date.now() / 1000)
      );
      
      // Update the embedding_id reference
      const embeddingRow = this.db.prepare(
        'SELECT rowid FROM semantic_embeddings WHERE memory_id = ?'
      ).get(memoryId);
      
      if (embeddingRow) {
        this.db.prepare('UPDATE semantic_memory SET embedding_id = ? WHERE id = ?')
          .run(embeddingRow.rowid, memoryId);
      }
    }
    
    return memoryId;
  }

  getSemanticById(id: number): SemanticMemory | null {
    if (!this.db) throw new Error('Not initialized');
    const row = this.db.prepare('SELECT * FROM semantic_memory WHERE id = ?').get(id) as any;
    return row ? this.rowToSemantic(row) : null;
  }

  updateSemanticAccess(id: number): void {
    if (!this.db) throw new Error('Not initialized');
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      UPDATE semantic_memory 
      SET access_count = access_count + 1, last_accessed = ?
      WHERE id = ?
    `).run(now, id);
  }

  // ==========================================================================
  // WORKING MEMORY PINS
  // ==========================================================================

  pinFile(sessionId: string, filePath: string, priority: number = 5, contentSnapshot?: string): void {
    if (!this.db) throw new Error('Not initialized');
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT OR REPLACE INTO working_memory_pins 
        (session_id, file_path, pinned_at, priority, content_snapshot)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, filePath, now, priority, contentSnapshot || null);
  }

  unpinFile(sessionId: string, filePath: string): void {
    if (!this.db) throw new Error('Not initialized');
    this.db.prepare(
      'DELETE FROM working_memory_pins WHERE session_id = ? AND file_path = ?'
    ).run(sessionId, filePath);
  }

  getPinnedFiles(sessionId: string): WorkingMemoryPin[] {
    if (!this.db) throw new Error('Not initialized');
    
    const rows = this.db.prepare(`
      SELECT * FROM working_memory_pins 
      WHERE session_id = ? 
      ORDER BY priority DESC, pinned_at DESC
    `).all(sessionId) as any[];

    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      filePath: r.file_path,
      pinnedAt: r.pinned_at,
      priority: r.priority,
      contentSnapshot: r.content_snapshot,
    }));
  }

  // ==========================================================================
 // ENTITY GRAPH (Tier 4)
  // ==========================================================================

  createEntityRelation(relation: EntityRelation): void {
    if (!this.db) throw new Error('Not initialized');
    
    this.db.prepare(`
      INSERT OR IGNORE INTO entity_graph 
        (source_id, source_type, target_id, target_type, relation_type, strength_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      relation.sourceId,
      relation.sourceType,
      relation.targetId,
      relation.targetType,
      relation.relationType,
      relation.strengthScore,
      relation.createdAt
    );
  }

  getRelatedMemories(memoryId: string, memoryType: 'episodic' | 'semantic', depth: number = 1): any[] {
    if (!this.db) throw new Error('Not initialized');
    
    // 1-hop traversal
    const rows = this.db.prepare(`
      SELECT 
        eg.*,
        CASE 
          WHEN eg.source_id = ? AND eg.source_type = ? THEN 'outgoing'
          ELSE 'incoming'
        END as direction
      FROM entity_graph eg
      WHERE (eg.source_id = ? AND eg.source_type = ?)
         OR (eg.target_id = ? AND eg.target_type = ?)
      ORDER BY eg.strength_score DESC
    `).all(memoryId, memoryType, memoryId, memoryType, memoryId, memoryType);

    return rows;
  }

  // ==========================================================================
  // ACCESS LOGGING
  // ==========================================================================

  logAccess(memoryId: string, memoryTier: MemoryTier, queryContext: string, 
            retrievalMethod: RetrievalMethod, resultRank: number): void {
    if (!this.db) throw new Error('Not initialized');
    
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO access_log 
        (memory_id, memory_tier, accessed_at, query_context, retrieval_method, result_rank)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(memoryId, memoryTier, now, queryContext, retrievalMethod, resultRank);
  }

  // ==========================================================================
  // CONSOLIDATION & MAINTENANCE
  // ==========================================================================

  getMemoriesForConsolidation(cutoffDays: number = 30): number[] {
    if (!this.db) throw new Error('Not initialized');
    const cutoff = Math.floor(Date.now() / 1000) - (cutoffDays * 86400);
    
    const rows = this.db.prepare(`
      SELECT id FROM episodic_memory 
      WHERE timestamp < ? 
        AND id NOT IN (SELECT CAST(source_id AS INTEGER) FROM entity_graph WHERE source_type = 'episodic')
      ORDER BY timestamp ASC
      LIMIT 100
    `).all(cutoff) as any[];

    return rows.map(r => r.id);
  }

  compressEpisodicToSemantic(episodicIds: number[], extractedFacts: string[], 
                             summary: string, embedding: number[]): void {
    if (!this.db) throw new Error('Not initialized');
    
    // Store extracted facts in semantic memory
    for (const fact of extractedFacts) {
      this.storeSemanticWithEmbedding({
        memoryType: 'fact',
        importanceScore: 7.0,
        content: fact,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        lastAccessed: Math.floor(Date.now() / 1000),
        accessCount: 1,
        compressionLevel: 1,
      }, embedding);
    }
    
    // Mark episodic as compressed
    const placeholders = episodicIds.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE episodic_memory 
      SET content = ?, metadata = json_patch(COALESCE(metadata, '{}'), '{"compressed": true}')
      WHERE id IN (${placeholders})
    `).run(summary, ...episodicIds);
  }

  getLowRelevanceMemories(threshold: number = 2.0): number[] {
    if (!this.db) throw new Error('Not initialized');
    
    const rows = this.db.prepare(`
      SELECT id FROM semantic_memory_relevance 
      WHERE relevance_score < ? AND importance_score < 3.0
    `).all(threshold) as any[];

    return rows.map(r => r.id);
  }

  archiveMemories(ids: number[]): void {
    if (!this.db) throw new Error('Not initialized');
    
    const placeholders = ids.map(() => '?').join(',');
    
    // Move to archival_search for FTS
    const memories = this.db.prepare(`
      SELECT id, content FROM semantic_memory WHERE id IN (${placeholders})
    `).all(...ids) as any[];
    
    for (const m of memories) {
      this.db.prepare(`
        INSERT INTO archival_search (content, memory_id, memory_tier)
        VALUES (?, ?, 'semantic')
      `).run(m.content, m.id);
    }
    
    // Update compression level
    this.db.prepare(`
      UPDATE semantic_memory SET compression_level = 2 WHERE id IN (${placeholders})
    `).run(...ids);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private rowToEpisodic(row: any): EpisodicMemory {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      turnNumber: row.turn_number,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      checkpointRef: row.checkpoint_ref,
      summary: row.summary,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      importanceScore: row.importance_score,
    };
  }

  private rowToSemantic(row: any): SemanticMemory {
    return {
      id: row.id,
      memoryType: row.memory_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      importanceScore: row.importance_score,
      content: row.content,
      context: row.context ? JSON.parse(row.context) : undefined,
      compressionLevel: row.compression_level,
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
