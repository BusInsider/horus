# Quick Start for New Agent

## ✅ FIXED: AI Now Responds!

**Root Cause**: SSE parsing bug - Kimi API sends `data:{...}` without space after colon, but code expected `data: {...}` with space.

**Fix Location**: `src/kimi.ts` line ~149

**The Fix**:
```typescript
// OLD (broken):
if (!trimmed.startsWith('data: ')) continue;  // Required space
const data = trimmed.slice(6);  // Would miss data without space

// NEW (fixed):
if (!trimmed.startsWith('data:')) continue;  // Space optional
const data = trimmed.slice(5).trimStart();  // Handle both formats
```

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
| `src/agent-enhanced.ts` | Main agent logic - contains `chat()` and `step()` |
| `src/kimi.ts` | API client - handles streaming |
| `src/memory/manager.ts` | SQLite persistence - stores conversation |
| `src/ui/terminal.ts` | Input handling - user prompts |

## API Details
- **Endpoint**: `https://api.kimi.com/coding/v1`
- **Key Format**: `sk-kimi-...` (get from platform.kimi.com)
- **User-Agent**: `KimiCLI/1.0` (required for api.kimi.com)
- **Model**: `kimi-for-coding` (mapped from `kimi-k2-5`)

See `HANDOFF.md` for full details.
