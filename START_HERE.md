# Quick Start for New Agent

## ✅ Current Status

- **Chat**: ✅ Working - AI responds to messages
- **Tool Execution**: ✅ Working - view, edit, bash, search tools all functional
- **Streaming**: ✅ Working - real-time response streaming
- **Memory**: ✅ Working - conversation history persists

## Recent Fixes

### 1. SSE Parsing Bug (Chat)
**Issue**: Kimi API sends `data:{...}` without space after colon, but code expected `data: {...}` with space.

**Fix**: Changed parsing in `kimi.ts` line ~149:
```typescript
// OLD:
if (!trimmed.startsWith('data: ')) continue;
const data = trimmed.slice(6);

// NEW:
if (!trimmed.startsWith('data:')) continue;
const data = trimmed.slice(5).trimStart();
```

### 2. Tool Execution Flow
**Issue**: Tool execution wasn't completing the ReAct loop properly.

**Fixes**:
- Added `doneHandled` flag to prevent duplicate assistant messages
- Added `reasoningContent` field to assistant messages with tool_calls (Kimi requirement)
- Changed tool error handling to continue conversation loop instead of stopping

## Environment Setup
```bash
# 1. Switch to Node 20 (CRITICAL - Node 25 breaks native modules)
nvm use 20

# 2. Go to project directory
cd ~/.hermes/workspace/horus

# 3. Build and run
npm run build
horus chat
```

## Key Files
| File | Purpose |
|------|---------|
| `src/agent-enhanced.ts` | Main agent logic - chat loop, step(), tool execution |
| `src/kimi.ts` | API client - streaming, tool call parsing |
| `src/memory/manager.ts` | SQLite persistence - messages, context |
| `src/tools/*.ts` | Tool implementations (view, edit, bash, search) |

## Testing Tool Execution
```bash
# Test basic chat
horus chat
> List the files in the current directory

# Test file creation  
horus chat
> Create a file called test.txt with "Hello World"
```

## API Details
- **Endpoint**: `https://api.kimi.com/coding/v1`
- **Key Format**: `sk-kimi-...` (get from platform.kimi.com)
- **User-Agent**: `KimiCLI/1.0` (required for api.kimi.com)
- **Model**: `kimi-for-coding` (mapped from `kimi-k2-5`)

See `HANDOFF.md` for full details.
