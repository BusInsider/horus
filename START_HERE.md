# Quick Start for New Agent

## ✅ Current Status

- **Chat**: ✅ Working - AI responds to messages
- **Tool Execution**: ✅ Working - view, edit, bash, search tools all functional
- **Streaming**: ✅ Working - real-time response streaming
- **Memory**: ✅ Working - conversation history persists
- **Four Modes**: ✅ Working - instant/thinking/agent/swarm modes

## Using Horus

### Basic Chat
```bash
horus chat                    # Default agent mode with tools
horus chat --mode instant     # Quick responses, no tools, cheapest
horus chat --mode thinking    # Complex reasoning, no tools
horus chat --mode agent       # Multi-tool workflows (default)
horus chat --mode swarm       # Parallel sub-agents
```

### Testing Tool Execution
```bash
# Test basic chat
horus chat --mode instant
> What is 2+2?

# Test tool execution
horus chat --mode agent
> List the files in the current directory

# Test file creation  
horus chat --mode agent
> Create a file called test.txt with "Hello World"
```

### Available Modes
```bash
horus modes    # Show all modes and their descriptions
```

| Mode | Temp | Tools | Use Case | Cost |
|------|------|-------|----------|------|
| **instant** | 0.6 | No | Quick Q&A, simple tasks | $0.60/M |
| **thinking** | 1.0 | No | Complex reasoning, analysis | $0.60/M |
| **agent** | 1.0 | Yes | File ops, code editing (default) | $0.60/M |
| **swarm** | 1.0 | Yes | Parallel batch processing | Varies |

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

## Available Tools (20 Total)

### File Operations
- `view`, `edit`, `cat`, `ls`, `mkdir`, `rm`

### Search
- `search` (ripgrep), `glob`, `grep` (regex)

### Git
- `git_status`, `git_diff`, `git_log`

### Data Processing
- `fetch` (HTTP), `json_parse`, `json_format`

### Utilities
- `bash`, `math` (calculator)

### Memory
- `recall`, `remember`, `index`

## Key Files
| File | Purpose |
|------|---------|
| `src/mode-controller.ts` | Four-mode system (instant/thinking/agent/swarm) |
| `src/agent-enhanced.ts` | Main agent logic - chat loop, step(), tool execution |
| `src/kimi.ts` | API client - streaming, tool call parsing |
| `src/memory/manager.ts` | SQLite persistence - messages, context |
| `src/tools/*.ts` | 20 tool implementations |

## API Details
- **Endpoint**: `https://api.kimi.com/coding/v1`
- **Key Format**: `sk-kimi-...` (get from platform.kimi.com)
- **User-Agent**: `KimiCLI/1.0` (required for api.kimi.com)
- **Model**: `kimi-for-coding` (mapped from `kimi-k2-5`, `kimi-k2-6`, `kimi-k2-6-preview`, `kimi-latest`)

See `HANDOFF.md` for full details.
