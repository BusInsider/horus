# Horus Project Handoff - April 9, 2026

## Project Overview
**Horus** is a Kimi-native autonomous coding agent (TypeScript/Node.js) inspired by Claude Code architecture. It provides an interactive chat interface with tool execution, memory, and planning capabilities.

**Current Status**: ✅ **Chat and tool execution working!** AI responds, uses tools (view, edit, bash, search), and completes tasks.

---

## Repository Location
```
~/.hermes/workspace/horus
```

## Key Configuration Files

### 1. User Config (`~/.hermes/config.json`)
```json
{
  "provider": {
    "apiKey": "sk-kimi-...",
    "model": "kimi-k2-5",  // or "kimi-k2-6", "kimi-k2-6-preview"
    "baseUrl": "https://api.kimi.com/coding/v1"
  },
  "workspace": {
    "defaultPath": "~/workspace"
  }
}
```
**Important**: Uses `sk-kimi-` keys from platform.kimi.com, NOT legacy Moonshot keys.

### 2. Project Config (`~/.hermes/workspace/horus/.horus/config.json`)
Auto-generated per-session configuration.

---

## Project Structure

```
~/.hermes/workspace/horus/
├── src/
│   ├── cli-enhanced.ts          # Main CLI entry point
│   ├── agent-enhanced.ts        # EnhancedAgent class (main agent logic)
│   ├── kimi.ts                  # Kimi API client
│   ├── ui/terminal.ts           # Terminal UI (input handling)
│   ├── memory/
│   │   └── manager.ts           # MemoryManager (SQLite + embeddings)
│   ├── tools/
│   │   ├── types.ts             # Tool type definitions
│   │   ├── view.ts              # File viewing tool
│   │   ├── edit.ts              # File editing tool
│   │   ├── bash.ts              # Command execution tool
│   │   └── ...                  # Other tools
│   └── ...
├── dist/
│   └── cli-enhanced.js          # Bundled executable (3.1MB)
├── TODO.md                      # Development roadmap
├── INTEGRATION_REVIEW.md        # Architecture review docs
└── package.json
```

---

## Critical Code Locations

### 1. API Client (`src/kimi.ts`)
**Lines 62-180**: Streaming chat completion handler
- **Key fix applied**: Handles `reasoning_content` from Kimi API (not just `content`)
- **Important**: Uses `User-Agent: KimiCLI/1.0` for api.kimi.com/coding/v1 endpoint
- **Model mapping**: `kimi-k2-5`, `kimi-k2-6`, `kimi-k2-6-preview`, `kimi-latest` → `kimi-for-coding` for Kimi API

### 2. Chat Loop (`src/agent-enhanced.ts`)
**Lines 118-185**: New `chat()` method for interactive mode
- Maintains session across multiple user inputs
- Calls `step()` for each conversation turn
- **Bug**: Conversation context may not persist correctly between turns

**Lines 350-452**: `step()` method
- Calls `kimi.stream()` with conversation history
- Handles tool execution
- **Issue**: May be resetting conversation state incorrectly

### 3. Terminal Input (`src/ui/terminal.ts`)
**Lines 161-173**: `prompt()` method
- Uses readline with `terminal: false` to avoid double-typing
- Creates fresh interface per prompt

### 4. CLI Entry (`src/cli-enhanced.ts`)
**Lines 179-219**: Main chat loop
- Calls `agent.chat()` with input handler
- Handles special commands (/agent, /checkpoint, etc.)

---

## Current Issues (Priority Order)

### 1. ✅ FIXED: Conversation Not Responding
**Symptom**: User types message, but no AI response was shown
**Root Cause**: SSE parsing bug in `src/kimi.ts` - Kimi API sends `data:{...}` (no space after colon) but code expected `data: {...}` (with space)

**The Fix** (`src/kimi.ts` line ~149):
```typescript
// OLD (broken):
if (!trimmed.startsWith('data: ')) continue;  // Required space
const data = trimmed.slice(6);  // Would miss data without space

// NEW (fixed):
if (!trimmed.startsWith('data:')) continue;  // Space optional
const data = trimmed.slice(5).trimStart();  // Handle both formats
```

### 2. Input Handling
**Status**: Fixed - No more double/triple typing
**Solution**: Changed readline to use `terminal: false` with manual prompt

### 3. ✅ Tool Execution Fixed
**Status**: Working!
- AI can now use tools (view, edit, bash, search)
- Tool results are fed back to AI
- AI can chain multiple tool calls
- Error handling allows recovery from failed tool calls

---

## What Works

✅ API Connection to Kimi (api.kimi.com/coding/v1)
✅ Authentication with sk-kimi- keys
✅ Streaming response parsing (including reasoning_content)
✅ Basic tool definitions (view, edit, bash, search, etc.)
✅ Memory system initialization (SQLite)
✅ Terminal input without double-typing
✅ Session start/end lifecycle

---

## What's Broken / Needs Work

✅ **AI Response**: ~~Not displaying~~ **FIXED!**
✅ **Tool Execution**: ~~Not working~~ **FIXED!** - view, edit, bash, search all functional
⚠️ **Checkpoint System**: UI shows error about missing checkpoints directory
⚠️ **Conversation Context**: Multi-turn conversation needs stress testing

---

## Running the Project

### Prerequisites
- Node.js 20 (managed via nvm)
- npm packages installed (`npm install`)

### Commands
```bash
# Set Node version (REQUIRED)
nvm use 20

# Run interactive chat
horus chat

# Run diagnostics
horus doctor

# Configure settings
horus configure

# Build from source
cd ~/.hermes/workspace/horus
npm run build
```

### Build Output
- Source: `src/cli-enhanced.ts`
- Bundle: `dist/cli-enhanced.js` (3.1MB)
- Target: Node 20, CommonJS format
- External deps: better-sqlite3, @xenova/transformers, etc.

---

## Architecture Overview

```
User Input → CLI → EnhancedAgent.chat() → step() → kimi.stream()
                                              ↓
                                       Memory Manager
                                              ↓
                                       SQLite Database
```

**ReAct Loop**:
1. **RECALL**: Get relevant memories from SQLite
2. **STREAM**: Call Kimi API with conversation history
3. **ACT**: Execute tools if AI requests them
4. **STORE**: Save conversation to memory

---

## Key Files for Debugging

1. `src/kimi.ts` - API client, check `stream()` method
2. `src/agent-enhanced.ts` - Main agent, check `chat()` and `step()` methods
3. `src/memory/manager.ts` - Memory persistence
4. `src/ui/terminal.ts` - Input handling

---

## Test Commands

```bash
# Test API connectivity
horus doctor

# Quick API test (from earlier debug session)
node -e "
const API_KEY = 'sk-kimi-...';
fetch('https://api.kimi.com/coding/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + API_KEY,
    'User-Agent': 'KimiCLI/1.0',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'kimi-for-coding',
    messages: [{role: 'user', content: 'hello'}],
    stream: true
  })
}).then(r => console.log('Status:', r.status));
"
```

---

## Related Projects

### Hermes Agent (Reference Implementation)
Location: `~/.hermes/hermes-agent/`
- Python-based agent that works well with Kimi
- Uses `prompt_toolkit` for UI
- Has proper conversation management
- Good reference for how to structure chat loops

Key Hermes files:
- `~/.hermes/hermes-agent/cli.py` - Main CLI (lines 7000+)
- `~/.hermes/hermes-agent/run_agent.py` - AIAgent class

---

## Environment Notes

### WSL2 Ubuntu 24.04
- User: jackm
- Home: `/home/jackm`
- Hermes workspace: `/home/jackm/.hermes`
- Horus project: `/home/jackm/.hermes/workspace/horus`

### Node.js Version Management
```bash
# Current Node version
node --version  # Should be v20.x.x

# If Node 25 is active, switch to 20
nvm use 20
nvm alias default 20
```

### API Keys
- Stored in: `~/.horus/config.json`
- Format: `sk-kimi-...` (not legacy `sk-...`)
- Endpoint: `https://api.kimi.com/coding/v1`
- User-Agent required: `KimiCLI/1.0`

---

## Development Roadmap

See `TODO.md` for full details. Key items:

1. ~~Fix conversation/chat loop~~ ✅ **FIXED** - SSE parsing bug resolved
2. Test tool execution
3. Verify checkpoint/rollback functionality
4. Add Claude Code architecture features:
   - Tool concurrency classification
   - System prompt caching
   - Streaming tool executor
5. Integration testing

---

## Summary for New Agent

**Status**: ✅ **AI Chat is Working!**

**What Was Fixed**:
- **Root Cause**: SSE parsing bug in `src/kimi.ts` line ~149
- **Issue**: Kimi API sends `data:{...}` (no space after colon) but code expected `data: {...}` (with space)
- **Fix**: Changed `startsWith('data: ')` to `startsWith('data:')` and used `trimStart()` to handle both formats

**Next Steps**:
1. Test tool execution (edit, bash, view, etc.)
2. Verify conversation history persists between turns
3. Test checkpoint/rollback functionality
4. Integration testing

---

## Skill System (NEW)

Horus now supports **dynamic skill generation** - AI-created tools that can be saved, versioned, and shared.

### Architecture

```
┌─────────────────┐     ┌─────────────┐     ┌──────────────┐
│  User Request   │────▶│  Generator  │────▶│  Kimi API    │
│  "Create CSV    │     │  (AI code   │     │  (generates  │
│   parser"       │     │   gen)      │     │   JS code)   │
└─────────────────┘     └─────────────┘     └──────────────┘
                                                      │
                              ┌───────────────────────┘
                              ▼
                       ┌─────────────┐
                       │   Skill     │
                       │  (manifest  │
                       │  + code)    │
                       └──────┬──────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Registry │   │   Disk   │   │  Agent   │
        │ (memory) │   │ (~/.horus│   │ (tools   │
        │          │   │ /skills) │   │  map)    │
        └──────────┘   └──────────┘   └──────────┘
```

### Key Components

1. **SkillGenerator** (`src/skills/generator.ts`)
   - Uses Kimi API to generate JS code from natural language
   - Validates generated code for safety
   - Handles skill evolution (version bumps)

2. **SkillRegistry** (`src/skills/registry.ts`)
   - Manages skill lifecycle
   - Loads from `~/.horus/skills/{builtin,user,community}/`
   - Compiles skills to Tool interface
   - Tracks usage statistics

3. **Skill Tools** (`src/tools/skill.ts`)
   - `skill_create` - Generate new skill
   - `skill_list` - List available skills
   - `skill_view` - Inspect skill details
   - `skill_delete` - Remove user skills
   - `skill_evolve` - Improve existing skill
   - `skill_stats` - Usage statistics

### Directory Structure

```
~/.horus/skills/
├── builtin/
│   └── csv_parser/              # Example built-in
│       ├── manifest.json        # {id, name, version, tags, ...}
│       └── skill.js             # {parameters, execute: "..."}
├── user/                        # AI/user created (persistent)
└── community/                   # Downloaded/shared
```

### Example Skill

**manifest.json:**
```json
{
  "id": "csv_parser",
  "name": "CSV Parser",
  "description": "Parse CSV strings into structured data",
  "version": "1.0.0",
  "author": "horus-builtin",
  "tags": ["data", "parsing"],
  "permissions": []
}
```

**skill.js:**
```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "csv": { "type": "string", "description": "CSV to parse" }
    },
    "required": ["csv"]
  },
  "execute": "const lines = args.csv.split('\\n'); ... return result;"
}
```

### Security

- Code validated for dangerous patterns (eval, new Function, require)
- Sandboxed execution (no direct fs/process access)
- Permissions system for capability tracking
- Safe mode option for extra validation

---

## Phase 2: Advanced Features (NEW)

### Tool Call Batching (MoE Optimization)

Groups parallel tool calls by semantic similarity for Kimi's MoE architecture.

**Location:** `src/tools/batcher.ts`

```typescript
// Semantic clusters
filesystem: ['view', 'edit', 'cat', 'ls', 'mkdir', 'rm', 'glob', 'grep']
network: ['fetch']
git: ['git_status', 'git_diff', 'git_log']
data: ['json_parse', 'json_format', 'math']
memory: ['recall', 'remember', 'index']
skills: ['skill_list', 'skill_create', ...]

// Usage
const batcher = getToolBatcher();
const batches = batcher.batchCalls(calls);
const results = await batcher.executeBatches(batches, context);
```

Features:
- Dependency resolution (topological sort)
- Parallel execution within batches
- MoE-optimized batch sizing
- Usage statistics

---

### Hibernation Architecture

Save and resume complete agent state.

**Location:** `src/hibernation.ts`

**Storage:** `~/.horus/hibernation/`

```typescript
// Checkpoint current state
const checkpoint = await hibernation.checkpoint(state, memory);

// Restore later
const { state, memoryData } = await hibernation.restore(checkpointId);

// Clone for MCTS exploration
const clone = await hibernation.clone(parentId, {
  inheritMemory: true,
  branchTag: 'exploration-1',
  explorationParams: { temperature: 0.8 }
});
```

CLI Commands:
```bash
horus hibernation list          # List saved states
horus hibernation delete <id>   # Delete a state
```

---

### Agent Swarm (PARL)

Multi-agent orchestration for complex tasks.

**Location:** 
- `src/swarm/orchestrator.ts` - Main orchestrator
- `src/swarm/subagent.ts` - Individual subagent
- `src/swarm/types.ts` - Type definitions

**PARL Pattern:**
1. **Planning** - Decompose objective into subtasks
2. **Acting** - Execute subagents in parallel groups
3. **Reflecting** - Coordinate and resolve conflicts
4. **Learning** - Synthesize results

```typescript
const orchestrator = new SwarmOrchestrator(kimi, hibernation);
const result = await orchestrator.execute("Complex objective");
```

CLI Commands:
```bash
horus swarm execute "Implement a REST API with auth and tests"
horus swarm status
```

**Configuration:**
- Strategy: hierarchical | flat | mesh
- Max parallel subagents: configurable
- Conflict resolution: orchestrator_decides | voting | priority

---

## Contact/Context

- This project was built to learn from Claude Code architecture
- Uses Kimi K2.5 and K2.6 (256k+ context) via Moonshot API
- Inspired by Nous Research Hermes Agent
- Started: April 8, 2026
- Last worked: April 9, 2026
