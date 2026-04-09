# Horus Project Handoff - April 9, 2026

## Project Overview
**Horus** is a Kimi-native autonomous coding agent (TypeScript/Node.js) inspired by Claude Code architecture. It provides an interactive chat interface with tool execution, memory, and planning capabilities.

**Current Status**: ✅ **AI chat is working!** SSE parsing bug fixed. Tool execution and checkpoint system need testing.

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
    "model": "kimi-k2-5",
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
- **Model mapping**: `kimi-k2-5` → `kimi-for-coding` for Kimi API

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

### 3. Session Persistence
**Status**: Partially working
- Session starts and shows session ID
- But conversation history may not persist between messages

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
⚠️ **Conversation Context**: Needs testing to verify history persists between turns
⚠️ **Tool Execution**: Needs testing now that chat works
⚠️ **Checkpoint System**: UI shows error about missing checkpoints directory

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

## Contact/Context

- This project was built to learn from Claude Code architecture
- Uses Kimi K2.5 (256k context) via Moonshot API
- Inspired by Nous Research Hermes Agent
- Started: April 8, 2026
- Last worked: April 9, 2026
