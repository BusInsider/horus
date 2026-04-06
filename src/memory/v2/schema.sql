-- HORUS MEMORY ARCHITECTURE v2.0 - Four-Tier Hierarchical Schema
-- CoALA-compliant with sqlite-vec vector extension

-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================================================
-- TIER 2: RECALL MEMORY (Recent sessions, checkpoints, search indices)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL, -- Unix timestamp
    updated_at INTEGER NOT NULL,
    workspace_path TEXT NOT NULL,
    context_checkpoint TEXT, -- JSON snapshot of Working Memory refs
    status TEXT CHECK(status IN ('active', 'paused', 'archived')) DEFAULT 'active',
    estimated_tokens INTEGER DEFAULT 0, -- Rolling count of Working Memory size
    metadata TEXT -- JSON: {name, tags, summary}
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Episodic Memory: Time-series event log (Tier 2)
CREATE TABLE IF NOT EXISTS episodic_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    turn_number INTEGER NOT NULL, -- Sequential within session
    role TEXT CHECK(role IN ('user', 'assistant', 'tool', 'system')),
    content TEXT NOT NULL,
    tool_calls TEXT, -- JSON array of ToolCall objects
    tool_results TEXT, -- JSON array of results
    checkpoint_ref TEXT, -- Git commit hash or file backup hash
    summary TEXT, -- 1-sentence LLM-generated summary
    metadata TEXT, -- JSON: {file_edits: [], tests_run: [], errors: []}
    importance_score REAL DEFAULT 5.0 CHECK(importance_score BETWEEN 1.0 AND 10.0)
);

CREATE INDEX IF NOT EXISTS idx_episodic_session_turn ON episodic_memory(session_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_episodic_timestamp ON episodic_memory(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance_score DESC);

-- ============================================================================
-- TIER 3: SEMANTIC MEMORY (Facts, preferences, skills, project knowledge)
-- ============================================================================

CREATE TABLE IF NOT EXISTS semantic_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_type TEXT CHECK(memory_type IN ('fact', 'preference', 'skill', 'code_pattern', 'bugfix', 'architecture')) DEFAULT 'fact',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, -- For temporal decay calculation
    last_accessed INTEGER NOT NULL,
    access_count INTEGER DEFAULT 1,
    importance_score REAL DEFAULT 5.0 CHECK(importance_score BETWEEN 1.0 AND 10.0),
    content TEXT NOT NULL, -- The actual fact/knowledge
    context TEXT, -- JSON: {related_files: [], project: '', tags: [], entities: []}
    embedding_id INTEGER UNIQUE, -- Foreign key to vec table
    compression_level INTEGER DEFAULT 0 -- 0=original, 1=summarized, 2=archived
);

CREATE INDEX IF NOT EXISTS idx_semantic_type ON semantic_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_semantic_accessed ON semantic_memory(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_importance ON semantic_memory(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_temporal ON semantic_memory(last_accessed, importance_score);

-- Procedural Memory: Skills & Workflows
CREATE TABLE IF NOT EXISTS procedural_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_name TEXT UNIQUE NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    success_rate REAL, -- Calculated from execution logs (0-1)
    avg_execution_time_ms INTEGER,
    definition TEXT NOT NULL, -- JSON: {steps: [], tools: [], validation: [], examples: []}
    usage_count INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT 1,
    context TEXT -- JSON: {applies_to: [], prerequisites: []}
);

CREATE INDEX IF NOT EXISTS idx_procedural_active ON procedural_memory(active);
CREATE INDEX IF NOT EXISTS idx_procedural_usage ON procedural_memory(usage_count DESC);

-- ============================================================================
-- TIER 4: ARCHIVAL MEMORY (Summarized old sessions, relationship graphs)
-- ============================================================================

-- Entity Graph: Relationships for Archival retrieval (GraphRAG)
CREATE TABLE IF NOT EXISTS entity_graph (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL, -- Can reference episodic or semantic ID
    source_type TEXT CHECK(source_type IN ('episodic', 'semantic')),
    target_id TEXT NOT NULL,
    target_type TEXT CHECK(target_type IN ('episodic', 'semantic')),
    relation_type TEXT CHECK(relation_type IN ('fixes', 'depends_on', 'related_to', 'caused_by', 'implements', 'references', 'contains')),
    strength_score REAL CHECK(strength_score BETWEEN 0.0 AND 1.0), -- Calculated by co-occurrence
    created_at INTEGER NOT NULL,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entity_source ON entity_graph(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_entity_target ON entity_graph(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_entity_relation ON entity_graph(relation_type);
CREATE INDEX IF NOT EXISTS idx_entity_strength ON entity_graph(strength_score DESC);

-- Memory Access Log: For decay calculations & LRU (all tiers)
CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL, -- Can be episodic_id or semantic_id
    memory_tier TEXT CHECK(memory_tier IN ('episodic', 'semantic', 'archival')),
    accessed_at INTEGER NOT NULL,
    query_context TEXT, -- What was the user asking?
    retrieval_method TEXT CHECK(retrieval_method IN ('vector', 'lexical', 'temporal', 'entity', 'direct')),
    result_rank INTEGER -- Position in results (1-based)
);

CREATE INDEX IF NOT EXISTS idx_access_memory ON access_log(memory_id, memory_tier);
CREATE INDEX IF NOT EXISTS idx_access_time ON access_log(accessed_at DESC);

-- ============================================================================
-- VECTOR EXTENSION (sqlite-vec)
-- ============================================================================

-- Semantic embeddings (384-dim for all-MiniLM-L6-v2)
CREATE VIRTUAL TABLE IF NOT EXISTS semantic_embeddings USING vec0(
    embedding float[384],
    +memory_id INTEGER REFERENCES semantic_memory(id) ON DELETE CASCADE,
    +content_hash TEXT, -- For deduplication
    +created_at INTEGER
);

-- Episodic embeddings (for recent session search)
CREATE VIRTUAL TABLE IF NOT EXISTS episodic_embeddings USING vec0(
    embedding float[384],
    +episodic_id INTEGER REFERENCES episodic_memory(id) ON DELETE CASCADE,
    +session_id TEXT,
    +turn_number INTEGER
);

-- ============================================================================
-- FULL-TEXT SEARCH (FTS5) - Tier 4 Archival
-- ============================================================================

-- Archival search for old content
CREATE VIRTUAL TABLE IF NOT EXISTS archival_search USING fts5(
    content,
    memory_id UNINDEXED,
    memory_tier UNINDEXED,
    tokenize='porter' -- Stemming for better recall
);

-- ============================================================================
-- CONSOLIDATION & MAINTENANCE
-- ============================================================================

-- Tracks consolidation jobs
CREATE TABLE IF NOT EXISTS consolidation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    source_tier TEXT NOT NULL, -- 'episodic' or 'semantic'
    target_tier TEXT NOT NULL, -- 'semantic' or 'archival'
    records_processed INTEGER DEFAULT 0,
    records_compressed INTEGER DEFAULT 0,
    facts_extracted INTEGER DEFAULT 0,
    status TEXT CHECK(status IN ('running', 'completed', 'failed')) DEFAULT 'running',
    error_message TEXT
);

-- Working Memory pins (files kept in context)
CREATE TABLE IF NOT EXISTS working_memory_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    pinned_at INTEGER NOT NULL,
    priority INTEGER DEFAULT 5, -- 1-10, higher = more important
    content_snapshot TEXT, -- Optional: content when pinned
    UNIQUE(session_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_pins_session ON working_memory_pins(session_id);
CREATE INDEX IF NOT EXISTS idx_pins_priority ON working_memory_pins(priority DESC);

-- ============================================================================
-- VIEWS FOR CONVENIENCE
-- ============================================================================

-- Memory with relevance score (for pruning decisions)
CREATE VIEW IF NOT EXISTS semantic_memory_relevance AS
SELECT 
    id,
    content,
    importance_score,
    access_count,
    last_accessed,
    (strftime('%s', 'now') - last_accessed) / 86400.0 as days_since_access,
    importance_score * EXP(-0.05 * ((strftime('%s', 'now') - last_accessed) / 86400.0)) + LOG(access_count + 1) * 0.5 as relevance_score
FROM semantic_memory;

-- Recently accessed memories (hot cache candidates)
CREATE VIEW IF NOT EXISTS hot_memories AS
SELECT 
    sm.*,
    COUNT(al.id) as recent_accesses
FROM semantic_memory sm
LEFT JOIN access_log al ON al.memory_id = sm.id AND al.accessed_at > strftime('%s', 'now') - 86400
GROUP BY sm.id
ORDER BY recent_accesses DESC, sm.last_accessed DESC
LIMIT 100;
