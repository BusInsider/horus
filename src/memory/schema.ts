// Database schema for Horus memory system

export const SCHEMA_SQL = `
-- Sessions: Each conversation
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cwd TEXT NOT NULL,
  summary TEXT
);

-- Working memory: Current conversation (limited size)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Episodic memory: Actions and their outcomes
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  context TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  embedding BLOB,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Semantic memory: Facts and learned patterns
CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  source TEXT,
  confidence REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  access_count INTEGER DEFAULT 1,
  embedding BLOB
);

-- Codebase index: Every file, indexed
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  size INTEGER NOT NULL,
  language TEXT,
  outline TEXT,
  summary TEXT,
  embedding BLOB,
  indexed_at INTEGER NOT NULL
);

-- Code chunks for granular retrieval
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT,
  name TEXT,
  embedding BLOB,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- Memory access log (for debugging and improving recall)
CREATE TABLE IF NOT EXISTS memory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  query TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  relevance REAL NOT NULL,
  used BOOLEAN DEFAULT 0,
  timestamp INTEGER NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_type ON episodes(action_type);
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
CREATE INDEX IF NOT EXISTS idx_facts_accessed ON facts(last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_memory_log_session ON memory_log(session_id);

-- Checkpoints for rollback
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  git_ref TEXT,
  snapshot_path TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);

-- Subagents for parallel execution
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

-- Documentation index (Context7-style)
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  embedding BLOB,
  indexed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_docs_path ON docs(path);

-- Learned patterns
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  language TEXT,
  category TEXT,
  usage_count INTEGER DEFAULT 1,
  examples TEXT,
  embedding BLOB,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patterns_language ON patterns(language);
CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
`;

// Types for TypeScript
export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  summary?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: string;
  toolCallId?: string;
  createdAt: number;
  tokens: number;
}

export interface Episode {
  id: string;
  sessionId: string;
  actionType: string;
  actionSummary: string;
  context: string;
  action: string;
  outcome: string;
  outcomeType: 'success' | 'error' | 'partial';
  createdAt: number;
  embedding?: number[];
}

export interface Fact {
  id: string;
  category: string;
  fact: string;
  source?: string;
  confidence: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  embedding?: number[];
}

export interface FileIndex {
  id: string;
  path: string;
  contentHash: string;
  lastModified: number;
  size: number;
  language?: string;
  outline?: string;
  summary?: string;
  indexedAt: number;
  embedding?: number[];
}

export interface CodeChunk {
  id: string;
  fileId: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType?: string;
  name?: string;
  embedding?: number[];
}

export interface MemoryLog {
  id: number;
  sessionId: string;
  query: string;
  memoryType: string;
  memoryId: string;
  relevance: number;
  used: boolean;
  timestamp: number;
}

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

export interface DocIndex {
  id: string;
  path: string;
  type: 'readme' | 'api_doc' | 'comment_block' | 'inline_doc';
  content: string;
  summary?: string;
  indexedAt: number;
  embedding?: number[];
}

export interface Pattern {
  id: string;
  pattern: string;
  language?: string;
  category?: 'idiom' | 'best_practice' | 'common_mistake' | 'pattern';
  usageCount: number;
  examples?: string[];
  createdAt: number;
  embedding?: number[];
}
