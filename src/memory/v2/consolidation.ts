// HORUS MEMORY ARCHITECTURE v2.0 - Autonomous Memory Management
// Consolidation, forgetting, and context pressure handling

import Database from 'better-sqlite3';
import { MemoryManagerV2 } from './manager.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConsolidationConfig {
  episodicMaxAgeDays: number;      // Archive episodic after 30 days
  consolidationIntervalHours: number; // Run every 24 hours
  relevanceThreshold: number;      // Prune semantic below 2.0
  compressionThreshold: number;    // Compress working memory at 80%
  importanceDecayLambda: number;   // 0.05 = 14-day half-life
}

export interface ConsolidationResult {
  episodicCompressed: number;
  semanticArchived: number;
  factsExtracted: number;
  spaceSavedMB: number;
}

// ============================================================================
// CONSOLIDATION ENGINE
// ============================================================================

export class ConsolidationEngine {
  private manager: MemoryManagerV2;
  private db: Database.Database;
  private config: ConsolidationConfig;

  constructor(
    manager: MemoryManagerV2,
    db: Database.Database,
    config: Partial<ConsolidationConfig> = {}
  ) {
    this.manager = manager;
    this.db = db;
    this.config = {
      episodicMaxAgeDays: 30,
      consolidationIntervalHours: 24,
      relevanceThreshold: 2.0,
      compressionThreshold: 0.8,
      importanceDecayLambda: 0.05,
      ...config,
    };
  }

  // ========================================================================
  // MAIN CONSOLIDATION JOB
  // ========================================================================

  async runFullConsolidation(): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      episodicCompressed: 0,
      semanticArchived: 0,
      factsExtracted: 0,
      spaceSavedMB: 0,
    };

    // Log start
    const jobId = this.logConsolidationStart();

    try {
      // Phase 1: Compress old episodic memories
      const episodicResult = await this.consolidateEpisodicTier();
      result.episodicCompressed = episodicResult.compressed;
      result.factsExtracted = episodicResult.factsExtracted;

      // Phase 2: Archive low-relevance semantic memories
      const semanticResult = await this.consolidateSemanticTier();
      result.semanticArchived = semanticResult.archived;

      // Phase 3: Clean up access logs (keep last 90 days)
      this.cleanupAccessLogs();

      // Calculate space saved
      result.spaceSavedMB = this.calculateSpaceSaved();

      // Log completion
      this.logConsolidationComplete(jobId, result);

    } catch (error) {
      this.logConsolidationError(jobId, error as Error);
      throw error;
    }

    return result;
  }

  // ========================================================================
  // PHASE 1: EPISODIC → SEMANTIC CONSOLIDATION
  // ========================================================================

  private async consolidateEpisodicTier(): Promise<{ compressed: number; factsExtracted: number }> {
    const cutoff = Math.floor(Date.now() / 1000) - (this.config.episodicMaxAgeDays * 86400);
    
    // Get batches of old episodic memories grouped by session
    const sessionGroups = this.db.prepare(`
      SELECT 
        session_id,
        GROUP_CONCAT(id) as memory_ids,
        COUNT(*) as count,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM episodic_memory
      WHERE timestamp < ?
        AND id NOT IN (
          SELECT CAST(source_id AS INTEGER) 
          FROM entity_graph 
          WHERE source_type = 'episodic'
        )
      GROUP BY session_id
      HAVING COUNT(*) >= 5
      LIMIT 10
    `).all(cutoff) as any[];

    let totalCompressed = 0;
    let totalFacts = 0;

    for (const group of sessionGroups) {
      const memoryIds = group.memory_ids.split(',').map(Number);
      
      // In a full implementation, this would call Kimi to extract facts
      // For now, we create a simple summary
      const summary = this.generateSessionSummary(group.session_id, group.count, group.oldest, group.newest);
      const facts = this.extractFactsFromSession(group.session_id, memoryIds);
      
      // Store extracted facts (would generate embedding in production)
      // this.manager.storeSemanticWithEmbedding({...}, embedding);
      
      // Compress the episodic memories (replace content with summary)
      this.compressEpisodicBatch(memoryIds, summary);
      
      totalCompressed += group.count;
      totalFacts += facts.length;
    }

    return { compressed: totalCompressed, factsExtracted: totalFacts };
  }

  private generateSessionSummary(sessionId: string, count: number, oldest: number, newest: number): string {
    const duration = Math.round((newest - oldest) / 60); // minutes
    return `Session ${sessionId.slice(0, 8)}: ${count} interactions over ${duration} minutes`;
  }

  private extractFactsFromSession(sessionId: string, memoryIds: number[]): string[] {
    // Simple fact extraction - in production, use LLM
    const facts: string[] = [];
    
    // Get high-importance memories from this session
    const important = this.db.prepare(`
      SELECT content FROM episodic_memory
      WHERE id IN (${memoryIds.map(() => '?').join(',')})
        AND importance_score >= 8
    `).all(...memoryIds) as any[];

    for (const row of important) {
      facts.push(row.content.slice(0, 200)); // Truncate for storage
    }

    return facts;
  }

  private compressEpisodicBatch(memoryIds: number[], summary: string): void {
    const placeholders = memoryIds.map(() => '?').join(',');
    
    // Update all memories in batch with compression marker
    this.db.prepare(`
      UPDATE episodic_memory
      SET content = CASE 
        WHEN id = ? THEN ?
        ELSE '[COMPRESSED] See memory ' || ?
      END,
      metadata = json_patch(COALESCE(metadata, '{}'), '{"compressed": true, "batch_size": ' || ? || '}')
      WHERE id IN (${placeholders})
    `).run(memoryIds[0], summary, memoryIds[0], memoryIds.length, ...memoryIds);
  }

  // ========================================================================
  // PHASE 2: SEMANTIC → ARCHIVAL CONSOLIDATION
  // ========================================================================

  private async consolidateSemanticTier(): Promise<{ archived: number }> {
    // Find low-relevance semantic memories
    const lowRelevanceIds = this.db.prepare(`
      SELECT id FROM semantic_memory_relevance
      WHERE relevance_score < ?
        AND importance_score < 3.0
        AND compression_level = 0
      LIMIT 100
    `).all(this.config.relevanceThreshold) as any[];

    const ids = lowRelevanceIds.map(r => r.id);
    
    if (ids.length > 0) {
      // Archive to FTS5
      this.manager.archiveMemories(ids);
      
      // Update compression level
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(`
        UPDATE semantic_memory 
        SET compression_level = 2 
        WHERE id IN (${placeholders})
      `).run(...ids);
    }

    return { archived: ids.length };
  }

  // ========================================================================
  // HEALTHY FORGETTING
  // ========================================================================

  calculateRelevance(memoryId: number): number {
    const row = this.db.prepare(`
      SELECT relevance_score 
      FROM semantic_memory_relevance 
      WHERE id = ?
    `).get(memoryId) as any;

    return row?.relevance_score || 0;
  }

  pruneStaleMemories(): number {
    const cutoff = Math.floor(Date.now() / 1000) - (90 * 86400); // 90 days
    
    // Delete very old access logs
    const result = this.db.prepare(`
      DELETE FROM access_log 
      WHERE accessed_at < ?
    `).run(cutoff);

    return result.changes;
  }

  // ========================================================================
  // CONTEXT PRESSURE MANAGEMENT
  // ========================================================================

  checkContextPressure(sessionId: string, currentTokens: number): {
    status: 'ok' | 'warning' | 'critical';
    action?: 'suggest_consolidation' | 'force_flush' | 'suggest_unpin';
    estimatedTurnsRemaining: number;
  } {
    const MAX_WORKING_TOKENS = 200000;
    const WARNING_THRESHOLD = MAX_WORKING_TOKENS * 0.7;  // 140k
    const CRITICAL_THRESHOLD = MAX_WORKING_TOKENS * 0.8; // 160k

    const ratio = currentTokens / MAX_WORKING_TOKENS;
    const estimatedTurnsRemaining = Math.floor((MAX_WORKING_TOKENS - currentTokens) / 2000);

    if (currentTokens > CRITICAL_THRESHOLD) {
      return {
        status: 'critical',
        action: 'force_flush',
        estimatedTurnsRemaining,
      };
    }

    if (currentTokens > WARNING_THRESHOLD) {
      // Check if we have pinned files we could unpin
      const pins = this.manager.getPinnedFiles(sessionId);
      const action = pins.length > 3 ? 'suggest_unpin' : 'suggest_consolidation';
      
      return {
        status: 'warning',
        action,
        estimatedTurnsRemaining,
      };
    }

    return {
      status: 'ok',
      estimatedTurnsRemaining,
    };
  }

  // ========================================================================
  // AUTOMATIC FLUSH TRIGGER
  // ========================================================================

  shouldFlushWorkingMemory(turnCount: number, lastFlushTurn: number): boolean {
    // Flush every 5 turns
    return turnCount - lastFlushTurn >= 5;
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  private cleanupAccessLogs(): void {
    const cutoff = Math.floor(Date.now() / 1000) - (90 * 86400); // Keep 90 days
    this.db.prepare('DELETE FROM access_log WHERE accessed_at < ?').run(cutoff);
  }

  private calculateSpaceSaved(): number {
    // Rough estimate based on row counts
    const stats = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM episodic_memory WHERE metadata LIKE '%compressed%') as compressed,
        (SELECT COUNT(*) FROM semantic_memory WHERE compression_level > 0) as archived
    `).get() as any;

    // Estimate ~1KB per compressed memory
    return ((stats?.compressed || 0) + (stats?.archived || 0)) * 0.001;
  }

  // ========================================================================
  // LOGGING
  // ========================================================================

  private logConsolidationStart(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare(`
      INSERT INTO consolidation_log (started_at, source_tier, target_tier, status)
      VALUES (?, 'episodic', 'semantic', 'running')
    `).run(now);
    
    return Number(result.lastInsertRowid);
  }

  private logConsolidationComplete(jobId: number, result: ConsolidationResult): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE consolidation_log
      SET completed_at = ?,
          records_processed = ?,
          records_compressed = ?,
          facts_extracted = ?,
          status = 'completed'
      WHERE id = ?
    `).run(now, result.episodicCompressed + result.semanticArchived, result.episodicCompressed, result.factsExtracted, jobId);
  }

  private logConsolidationError(jobId: number, error: Error): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      UPDATE consolidation_log
      SET completed_at = ?,
          status = 'failed',
          error_message = ?
      WHERE id = ?
    `).run(now, error.message, jobId);
  }
}

// ============================================================================
// SCHEDULER
// ============================================================================

export class ConsolidationScheduler {
  private engine: ConsolidationEngine;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(engine: ConsolidationEngine, intervalHours: number = 24) {
    this.engine = engine;
    this.intervalMs = intervalHours * 60 * 60 * 1000;
  }

  start(): void {
    if (this.timer) return;
    
    // Run immediately, then on schedule
    this.runJob();
    
    this.timer = setInterval(() => this.runJob(), this.intervalMs);
    console.log(`[Consolidation] Scheduled every ${this.intervalMs / 3600000} hours`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runJob(): Promise<void> {
    if (this.isRunning) {
      console.log('[Consolidation] Previous job still running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('[Consolidation] Starting scheduled consolidation...');

    try {
      const result = await this.engine.runFullConsolidation();
      console.log(`[Consolidation] Complete: ${result.episodicCompressed} episodic compressed, ${result.semanticArchived} semantic archived, ${result.factsExtracted} facts extracted`);
    } catch (error) {
      console.error('[Consolidation] Failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async runNow(): Promise<ConsolidationResult> {
    return this.engine.runFullConsolidation();
  }
}
