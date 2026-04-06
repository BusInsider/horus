# Horus

> Hermes-equivalent autonomous coding agent for Kimi K2.5 with sophisticated memory, plan mode, and MCP integration.

## Features

- **256k Context** - Native optimization for Kimi K2.5
- **Memory System** - Episodic + semantic + codebase indexing
- **Plan Mode** - Generate and execute structured plans
- **Checkpoints** - Git-based rollback for safety
- **Subagents** - Parallel task execution
- **MCP Support** - Connect to external tool servers
- **Workspace** - Configurable default working directory

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Initialize config (creates ~/.horus/config.json)
node dist/cli-enhanced.js init

# Set your API key
export KIMI_API_KEY="your-key-here"
# Or edit ~/.horus/config.json

# Start using
node dist/cli-enhanced.js chat
```

## Security

**API keys are NEVER stored in this repository.**

- Config stored in `~/.horus/config.json` (outside repo)
- `.gitignore` prevents accidental commits of sensitive files
- Environment variables can also be used (see `.env.example`)

## Commands

```bash
# Interactive session
horus chat [path]              # Use default workspace or specify path
horus chat --plan              # Enable plan mode

# One-shot execution
horus run "task description"

# Plan mode
horus plan "objective"         # Generate PLAN.md
horus rollback [checkpoint]    # Rollback to checkpoint

# Workspace management
horus workspace                # Show current workspace
horus workspace ~/projects     # Set new workspace

# Session management
horus sessions                 # List sessions
horus checkpoints              # List checkpoints
horus config                   # Show configuration
```

## Slash Commands (in chat)

```
/agent list                    # List available agents
/agent deploy <id> <task>      # Deploy agent as subagent
/checkpoint [name]             # Create checkpoint
/rollback [id]                 # Rollback
/task [description]            # Spawn subagent
/plan [objective]              # Generate plan
```

## Configuration

Edit `~/.horus/config.json`:

```json
{
  "provider": {
    "apiKey": "your-key",
    "model": "kimi-k2-5",
    "baseUrl": "https://api.moonshot.cn/v1"
  },
  "workspace": {
    "defaultPath": "~/workspace",
    "autoIndex": true
  },
  "memory": {
    "dbPath": "~/.horus/memory.db",
    "maxWorkingTokens": 50000
  },
  "agent": {
    "mode": "semi",
    "maxIterations": 50
  }
}
```

## Architecture

```
src/
├── agents/           # Agent system (optional)
├── memory/           # SQLite + embeddings
├── tools/            # Core tools (view, edit, bash, search)
├── mcp/              # MCP client for external tools
├── utils/            # Logger, paths
├── agent-enhanced.ts # Main agent loop
├── checkpoint.ts     # Rollback system
├── plan.ts           # Plan mode
├── subagent.ts       # Parallel execution
└── cli-enhanced.ts   # CLI entry point
```

## Development

```bash
# Type check
npm run typecheck

# Build
npm run build

# Validate installation
node validate.js
```

## License

MIT
