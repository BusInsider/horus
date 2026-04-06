// HORUS MEMORY ARCHITECTURE v2.0 - Agentic Memory Tools
// Kimi-controlled memory management (Letta-style)

import { MemoryManagerV2, MemoryType, MemoryTier } from './manager.js';
import { FourChannelFusion, QueryContext, EmbeddingCache } from './retrieval.js';
import { EmbeddingProvider } from '../embedding.js';

// ============================================================================
// MEMORY TOOLKIT INTERFACE
// ============================================================================

export interface MemoryToolKit {
  remember(content: string, type: MemoryType, importance: number, context?: Record<string, any>): Promise<{
    memoryId: number;
    embeddingStored: boolean;
  }>;
  recall(query: string, limit?: number): Promise<{
    results: Array<{
      content: string;
      tier: MemoryTier;
      relevanceScore: number;
      timestamp?: number;
    }>;
  }>;
  forget(memoryId: string, reason: string): Promise<boolean>;
  consolidate(targetTier: 'episodic' | 'semantic'): Promise<{
    compressed: number;
    preserved: number;
  }>;
  pinToWorking(filePath: string, priority?: number): Promise<void>;
  unpinFromWorking(filePath: string): Promise<void>;
  getWorkingMemoryStatus(): Promise<{
    tokensUsed: number;
    tokensAvailable: number;
    pinnedFiles: string[];
    estimatedTurnsRemaining: number;
  }>;
}

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

export class AgenticMemoryTools implements MemoryToolKit {
  private manager: MemoryManagerV2;
  private fusion: FourChannelFusion;
  private embedder: EmbeddingProvider;
  private cache: EmbeddingCache;
  private sessionId: string;
  private currentTurn: number = 0;

  constructor(
    manager: MemoryManagerV2,
    fusion: FourChannelFusion,
    embedder: EmbeddingProvider,
    sessionId: string,
    cacheSize: number = 1000
  ) {
    this.manager = manager;
    this.fusion = fusion;
    this.embedder = embedder;
    this.sessionId = sessionId;
    this.cache = new EmbeddingCache(cacheSize);
  }

  setTurnNumber(turn: number): void {
    this.currentTurn = turn;
  }

  async remember(
    content: string, 
    type: MemoryType = 'fact', 
    importance: number = 5,
    context: Record<string, any> = {}
  ): Promise<{ memoryId: number; embeddingStored: boolean }> {
    const now = Math.floor(Date.now() / 1000);
    
    let embedding = this.cache.get(content);
    if (!embedding) {
      embedding = await this.embedder.embed(content);
      this.cache.set(content, embedding);
    }

    const memoryId = this.manager.storeSemanticWithEmbedding({
      memoryType: type,
      importanceScore: Math.max(1, Math.min(10, importance)),
      content,
      context: {
        relatedFiles: context.relatedFiles || [],
        project: context.project,
        tags: context.tags || [],
        entities: context.entities || [],
      },
      createdAt: now,
      updatedAt: now,
      lastAccessed: now,
      accessCount: 1,
    }, embedding);

    this.manager.logAccess(String(memoryId), 'semantic', 'remember() call', 'direct', 1);

    return { memoryId, embeddingStored: true };
  }

  async recall(query: string, limit: number = 10): Promise<{
    results: Array<{
      content: string;
      tier: MemoryTier;
      relevanceScore: number;
      timestamp?: number;
    }>;
  }> {
    let embedding = this.cache.get(query);
    if (!embedding) {
      embedding = await this.embedder.embed(query);
      this.cache.set(query, embedding);
    }

    const context: QueryContext = {
      sessionId: this.sessionId,
      currentEntities: this.extractEntities(query),
      recentFileEdits: [],
    };

    const results = this.fusion.retrieve(query, embedding, context, { k: limit });

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      this.manager.logAccess(result.id, result.tier, query, 'vector', i + 1);
      if (result.tier === 'semantic') {
        this.manager.updateSemanticAccess(Number(result.id));
      }
    }

    return {
      results: results.map(r => ({
        content: r.content,
        tier: r.tier,
        relevanceScore: r.relevanceScore,
        timestamp: r.timestamp,
      })),
    };
  }

  async forget(memoryId: string, reason: string): Promise<boolean> {
    const [tier, id] = memoryId.split(':');
    
    if (tier === 'semantic') {
      this.manager.archiveMemories([Number(id)]);
      console.log(`[Memory] Archived semantic memory ${id}: ${reason}`);
      return true;
    }
    
    if (tier === 'episodic') {
      console.log(`[Memory] Marked episodic memory ${id} for consolidation: ${reason}`);
      return true;
    }

    return false;
  }

  async consolidate(targetTier: 'episodic' | 'semantic'): Promise<{
    compressed: number;
    preserved: number;
  }> {
    if (targetTier === 'episodic') {
      const ids = this.manager.getMemoriesForConsolidation(30);
      
      if (ids.length === 0) {
        return { compressed: 0, preserved: 0 };
      }

      const summary = `Consolidated ${ids.length} episodic memories`;
      const extractedFacts = [`Session contained ${ids.length} interactions`];
      const embedding = await this.embedder.embed(summary);
      
      this.manager.compressEpisodicToSemantic(ids, extractedFacts, summary, embedding);

      return { compressed: ids.length, preserved: extractedFacts.length };
    }

    if (targetTier === 'semantic') {
      const ids = this.manager.getLowRelevanceMemories(2.0);
      if (ids.length > 0) {
        this.manager.archiveMemories(ids);
      }
      return { compressed: ids.length, preserved: 0 };
    }

    return { compressed: 0, preserved: 0 };
  }

  async pinToWorking(filePath: string, priority: number = 5): Promise<void> {
    this.manager.pinFile(this.sessionId, filePath, priority);
    console.log(`[Memory] Pinned ${filePath} to Working Memory (priority: ${priority})`);
  }

  async unpinFromWorking(filePath: string): Promise<void> {
    this.manager.unpinFile(this.sessionId, filePath);
    console.log(`[Memory] Unpinned ${filePath} from Working Memory`);
  }

  async getWorkingMemoryStatus(): Promise<{
    tokensUsed: number;
    tokensAvailable: number;
    pinnedFiles: string[];
    estimatedTurnsRemaining: number;
  }> {
    const pins = this.manager.getPinnedFiles(this.sessionId);
    const session = this.manager.getSession(this.sessionId);
    
    let tokensUsed = session?.estimated_tokens || 0;
    const pinnedFiles = pins.map(p => p.filePath);
    
    const MAX_WORKING_TOKENS = 200000;
    const AVG_TURN_TOKENS = 2000;
    const tokensAvailable = MAX_WORKING_TOKENS - tokensUsed;
    const estimatedTurnsRemaining = Math.floor(tokensAvailable / AVG_TURN_TOKENS);

    return { tokensUsed, tokensAvailable, pinnedFiles, estimatedTurnsRemaining };
  }

  async storeEpisodicTurn(
    role: 'user' | 'assistant' | 'tool' | 'system',
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    
    let embedding = this.cache.get(content);
    if (!embedding) {
      embedding = await this.embedder.embed(content);
      this.cache.set(content, embedding);
    }

    return this.manager.storeEpisodicWithEmbedding({
      sessionId: this.sessionId,
      timestamp: now,
      turnNumber: this.currentTurn,
      role,
      content,
      metadata,
      importanceScore: metadata.importance || 5.0,
    }, embedding);
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    
    const fileMatches = text.match(/[\w/\\.-]+\.(ts|js|json|md|py|rs|go|java)/gi);
    if (fileMatches) entities.push(...fileMatches);
    
    const capitalMatches = text.match(/\b[A-Z][a-zA-Z0-9]+\b/g);
    if (capitalMatches) entities.push(...capitalMatches);
    
    const symbolMatches = text.match(/\b[a-z_][a-z0-9_]*[A-Z][a-zA-Z0-9_]*\b/g);
    if (symbolMatches) entities.push(...symbolMatches);
    
    return [...new Set(entities)];
  }
}

// ============================================================================
// SYSTEM PROMPT INTEGRATION
// ============================================================================

export const MEMORY_SYSTEM_PROMPT = `
## Your Memory Architecture (Horus v2.0)

You have a hierarchical memory system with four tiers:

1. Working Memory (200k tokens): Currently active. You can see all open files and recent conversation.
2. Recall Memory (last 30 days): Recent sessions and checkpoints stored as episodic memories.
3. Semantic Memory: Long-term facts, preferences, code patterns, and skills.
4. Archival Memory: Summarized old sessions with relationship graphs.

### Memory Tools Available:

You can actively manage your memory using these tools:

- remember(content, type, importance, context) - Store critical facts for future sessions.
- recall(query, limit) - Search across all memory tiers using 4-channel fusion.
- pinToWorking(filePath, priority) - Keep specific files in your 256k context window.
- unpinFromWorking(filePath) - Remove a file from Working Memory.
- consolidate(tier) - Trigger memory compression (usually automatic).
- forget(memoryId, reason) - Archive a memory (rarely needed).

### Memory Strategy:

- Keep active files pinned
- Store patterns, not noise
- Recall proactively
- Monitor context usage
- Build user model

Your memory system gives you genuine continuity across sessions. Use it actively!
`;
