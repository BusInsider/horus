# Horus: Hermes-Equivalent for Kimi K2.5 and K2.6

> An autonomous coding agent with Hermes-level flexibility, supercharged for Kimi K2.5 and K2.6's 256k context.

**Core Philosophy**: Hermes-like flexibility meets Kimi K2.5 and K2.6's power. Plan mode, subagents, checkpoints, and automatic memory.

---

## 1. Key Features (Hermes Parity)

| Feature | Hermes | Horus |
|---------|--------|-------|
| Plan Mode | ✅ Write plans to file | ✅ PLAN.md with checkpoints |
| Subagents | ✅ Parallel tasks | ✅ `Task()` equivalent |
| Context7 | ✅ Knowledge base | ✅ SQLite + embeddings |
| Checkpoints | ✅ Rollback | ✅ Git + file snapshots |
| 256k Context | ❌ (Claude limited) | ✅ Native optimization |
| Streaming | ✅ | ✅ Zero-buffer |
| Tool Use | ✅ Rich | ✅ View/Edit/Bash/Search + Memory |
| Background Tasks | ✅ `/task` | ✅ `/task` equivalent |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HORUS CLI                                    │
│  - Plan mode: Write PLAN.md before execution                    │
│  - Auto mode: Execute directly                                  │
│  - Background tasks: Parallel execution                         │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    AGENT ORCHESTRATOR                            │
│  - Plan parsing and checkpoint management                        │
│  - Subagent spawning with context isolation                      │
│  - Tool dispatch & parallelization                               │
│  - Rollback on failure                                           │
└──────┬───────────────┬─────────────────┬────────────────────────┘
       │               │                 │
┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼────────┐
│ KIMI CLIENT │ │  TOOLS      │ │  SUBAGENTS    │
│ - Streaming │ │  - view     │ │  - Parallel   │
│ - 256k ctx  │ │  - edit     │ │  - Isolated   │
│ - Pooling   │ │  - bash     │ │  - Reporting  │
└─────────────┘ │  - search   │ └───────────────┘
                │  - recall   │
                │  - remember │
                │  - glob     │
                └─────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│   MEMORY     │ │CHECKPOINT│ │  CONTEXT7    │
│   SYSTEM     │ │  SYSTEM  │ │  KNOWLEDGE   │
│              │ │          │ │              │
│ - Episodic   │ │ - Git    │ │ - Codebase   │
│ - Semantic   │ │ - Files  │ │ - Docs       │
│ - Codebase   │ │ - Snap   │ │ - Learned    │
└──────────────┘ └──────────┘ └──────────────┘
```

---

## 3. Plan Mode

Hermes has a powerful plan mode. Horus implements the same:

```bash
$ horus plan "Add authentication system"
# Generates PLAN.md with:
# - Task breakdown
# - Checkpoints for rollback
# - Tool calls needed
# User reviews, approves, executes
```

**PLAN.md Format:**
```markdown
# Plan: Add authentication system

## Objective
Implement JWT-based authentication with login/logout endpoints.

## Checkpoints
- [ ] 1. Install dependencies (jsonwebtoken, bcrypt)
- [ ] 2. Create auth middleware
- [ ] 3. Add login endpoint
- [ ] 4. Add logout endpoint
- [ ] 5. Write tests

## Rollback Strategy
Each checkpoint creates a git commit. Rollback with `git reset --hard <checkpoint>`.

## Tools Required
- edit
- bash
- search

## Estimated Tokens
~15k for implementation, ~5k for tests
```

---

## 4. Subagents

Spawn parallel tasks like Hermes:

```typescript
// In agent code
const results = await Promise.all([
  subagent.analyzeFile('src/auth.ts'),
  subagent.analyzeFile('src/user.ts'),
  subagent.analyzeFile('src/middleware.ts'),
]);

// Or background task
const taskId = subagent.spawn({
  description: "Refactor utils",
  prompt: "Find all utility functions and consolidate...",
});

// Check progress
const status = subagent.status(taskId);
```

**Subagent Features:**
- Context isolation (fresh memory, no pollution)
- Result aggregation
- Error propagation
- Timeout handling

---

## 5. Checkpoint System

Git-based + file snapshots:

```typescript
// Before risky operation
checkpoint.create("Before auth refactor");

// On failure
checkpoint.rollback();

// Or selective rollback
checkpoint.rollbackTo("Before auth refactor");
```

**Implementation:**
- Git commits with tags `horus-checkpoint-N`
- File snapshots for non-git files
- Metadata in SQLite

---

## 6. Memory System (Enhanced)

Beyond basic memory - Context7 style:

### 6.1 Episodic Memory
```sql
-- What we did, when, outcome
episodes: id, action, context, outcome, timestamp, embedding
```

### 6.2 Semantic Memory
```sql
-- Learned facts
facts: id, fact, category, confidence, source, embedding
```

### 6.3 Codebase Knowledge (Context7)
```sql
-- Indexed code with semantic search
files: id, path, content_hash, outline, summary, embedding
chunks: id, file_id, content, type, name, embedding

-- Learned patterns
patterns: id, pattern, language, usage_count, embedding
```

### 6.4 Documentation Memory
```sql
-- Indexed docs, READMEs, comments
docs: id, path, content, summary, embedding
```

---

## 7. Enhanced Tool System

### 7.1 Core Tools
- `view` - File/directory viewing with memory context
- `edit` - Diff-based editing with syntax validation
- `bash` - Command execution with PTY streaming
- `search` - Ripgrep + semantic search
- `glob` - File discovery

### 7.2 Memory Tools
- `recall` - Query memory
- `remember` - Store fact
- `index` - Index codebase

### 7.3 Plan Tools
- `checkpoint` - Create checkpoint
- `rollback` - Rollback to checkpoint
- `plan` - Generate plan

### 7.4 Subagent Tools
- `spawn` - Spawn subagent
- `status` - Check subagent status
- `wait` - Wait for subagent

---

## 8. Agent Loop (Sophisticated)

```
INIT -> PLAN? -> CHECKPOINT -> EXECUTE -> VERIFY -> [DONE or ROLLBACK]
            |         |            |          |
            ▼         ▼            ▼          ▼
        Write    Git commit    Tool calls   Tests pass?
        PLAN.md  + snapshot    + streaming   If not, rollback
```

**States:**
1. **INIT** - Load context, recall relevant memories
2. **PLAN** (optional) - Generate PLAN.md, get approval
3. **CHECKPOINT** - Create rollback point
4. **EXECUTE** - Run tools, stream output
5. **VERIFY** - Run tests/checks
6. **DONE** or **ROLLBACK**

---

## 9. Configuration

```json
{
  "provider": {
    "apiKey": "${KIMI_API_KEY}",
    "model": "kimi-k2-5",  // or "kimi-k2-6", "kimi-k2-6-preview"
    "baseUrl": "https://api.moonshot.cn/v1"
  },
  "agent": {
    "mode": "semi",
    "maxIterations": 50,
    "autoCheckpoint": true,
    "planMode": false
  },
  "memory": {
    "dbPath": "~/.horus/memory.db",
    "embeddingModel": "Xenova/all-MiniLM-L6-v2",
    "autoIndex": true,
    "indexInterval": 300
  },
  "subagents": {
    "maxConcurrent": 5,
    "timeout": 300
  }
}
```

---

## 10. CLI Commands

```bash
horus init                              # Initialize config
horus chat [path]                       # Interactive session
horus chat [path] --resume <id>         # Resume session
horus run "task" [path]                 # One-shot task
horus plan "task" [path]                # Generate PLAN.md
horus execute PLAN.md                   # Execute plan
horus rollback [checkpoint]             # Rollback
horus sessions                          # List sessions
horus checkpoints                       # List checkpoints
horus index [path]                      # Force re-index
horus config                            # Show config
```

---

## 11. Implementation Priorities

### Phase 1: Core (Week 1)
- [x] Basic project setup
- [x] SQLite schema
- [x] Kimi client
- [x] Basic tools (view, edit, bash, search)
- [x] Memory manager
- [x] Agent loop

### Phase 2: Hermes Parity (Week 2)
- [ ] Plan mode (PLAN.md generation)
- [ ] Checkpoint system
- [ ] Subagent spawning
- [ ] Enhanced memory (Context7 style)
- [ ] Background tasks

### Phase 3: Polish (Week 3)
- [ ] Rollback UI
- [ ] Session management
- [ ] Config wizard
- [ ] Documentation

---

*This is Horus - Hermes-level flexibility with Kimi K2.5 and K2.6 power.*
