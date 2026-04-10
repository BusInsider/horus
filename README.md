# Horus 🦅

> A Kimi-native autonomous coding agent with dynamic skill generation, multi-agent swarm capabilities, and 256K context support.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/BusInsider/horus)
[![Version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/BusInsider/horus/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-339933)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

## ✨ Features

### Core Capabilities
- **🧠 Four-Mode System**: Instant, Thinking, Agent, and Swarm modes with different temperature/tool settings
- **💾 Advanced Memory**: SQLite-based episodic memory with embeddings for semantic recall
- **🔧 Dynamic Skills**: AI generates new tools on demand via `skill_create`
- **🐝 Agent Swarm**: Multi-agent orchestration for complex parallel tasks
- **💤 Hibernation**: Save and resume complete agent state with MCTS-style cloning
- **⚡ Tool Batching**: MoE-optimized parallel tool execution
- **📊 256K Context**: Native support for Kimi K2.5's large context window

### Developer Experience
- **🔒 Safe Execution**: Sandboxed skill execution with dangerous pattern detection
- **📋 Plan Mode**: Generate structured execution plans with checkpoint rollback
- **🔄 Checkpoints**: Git-based and file snapshot rollback capabilities
- **🔍 Codebase Indexing**: Automatic project indexing for semantic search
- **🛡️ Security**: Path traversal protection, dangerous command blocking

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/BusInsider/horus.git
cd horus

# Install dependencies
npm install

# Build the project
npm run build

# Install globally (optional)
npm link
```

### Configuration

```bash
# Initialize configuration
horus init

# Or manually edit ~/.horus/config.json
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

### Usage

```bash
# Interactive chat session
horus chat

# Chat with plan mode enabled
horus chat --plan

# Use specific mode
horus chat --mode instant    # Fast responses, no tools
horus chat --mode thinking   # Standard reasoning
horus chat --mode agent      # Full tool access (default)
horus chat --mode swarm      # Multi-agent mode

# Execute single task
horus run "Refactor the auth module"

# Run with plan mode
horus run "Add user authentication" --plan

# Multi-agent swarm execution
horus swarm execute "Implement a REST API with auth and tests"
```

## 📚 Commands Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `horus init` | Initialize configuration |
| `horus chat [path]` | Interactive chat session |
| `horus run <task>` | Execute single task |
| `horus plan <objective>` | Generate plan without executing |
| `horus doctor` | Run diagnostics |
| `horus config` | Show current configuration |
| `horus configure` | Interactive configuration wizard |

### Session Management

| Command | Description |
|---------|-------------|
| `horus sessions list` | List all saved sessions |
| `horus sessions archive` | Archive old sessions |
| `horus sessions archives` | List archived sessions |
| `horus checkpoints` | List checkpoints |
| `horus rollback [id]` | Rollback to checkpoint |

### Skill Management

| Command | Description |
|---------|-------------|
| `horus skill_list` | List available skills |
| `horus skill_create` | Create new skill via AI generation |
| `horus skill_view <id>` | View skill details |
| `horus skill_delete <id>` | Delete a skill |
| `horus skill_evolve <id>` | Improve existing skill |
| `horus skill_stats` | Show skill usage statistics |

### Hibernation & Swarm

| Command | Description |
|---------|-------------|
| `horus hibernation list` | List saved agent states |
| `horus hibernation delete <id>` | Delete saved state |
| `horus swarm execute <objective>` | Run multi-agent task |
| `horus swarm status` | Show swarm status |

### GitHub Integration

| Command | Description |
|---------|-------------|
| `horus gh pr create` | Create pull request |
| `horus gh pr list` | List pull requests |
| `horus gh pr view <num>` | View PR details |
| `horus gh issue list` | List issues |
| `horus gh issue create` | Create issue |

## 🧩 Architecture

### Four-Mode System

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│   Instant   │  Thinking   │    Agent    │    Swarm    │
├─────────────┼─────────────┼─────────────┼─────────────┤
│ Temp: 0.6   │ Temp: 1.0   │ Temp: 1.0   │ Temp: 0.7   │
│ Tools: ❌   │ Tools: ❌   │ Tools: ✅   │ Tools: ✅   │
│ Speed: ⚡   │ Speed: 🔄   │ Speed: 🔄   │ Speed: 🐝   │
│ Cost: $0.60 │ Cost: $0.60 │ Cost: $3.00 │ Cost: Varies│
└─────────────┴─────────────┴─────────────┴─────────────┘
```

### Skill System

Skills are dynamically generated JavaScript tools:

```
User: "Create a skill that fetches weather"
  │
  ▼
┌─────────────────┐
│ SkillGenerator  │──▶ Kimi API generates JS code
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Validation    │──▶ Security checks (no eval, etc.)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Registry      │──▶ Available immediately as tool
└─────────────────┘
```

### Agent Swarm (PARL)

```
User Objective
     │
     ▼
┌─────────────┐
│   Planning  │──▶ Decompose into subtasks
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│    Parallel Agent Groups        │
│  ┌─────┐ ┌─────┐ ┌─────┐      │
│  │Sub- │ │Sub- │ │Sub- │ ...   │
│  │agent│ │agent│ │agent│       │
│  └──┬──┘ └──┬──┘ └──┬──┘       │
│     │       │       │          │
│     ▼       ▼       ▼          │
│   Result Aggregation           │
└─────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  Synthesis  │──▶ Unified result
└─────────────┘
```

## 🛡️ Security

### API Key Storage
- Keys stored in `~/.horus/config.json` (outside repo)
- Never logged or displayed (masked in doctor output)
- Environment variable support: `KIMI_API_KEY`

### Skill Sandbox
- Code validated for dangerous patterns (eval, new Function, require)
- No direct filesystem/process access
- Permission system for capability tracking

### Command Safety
- Bash tool blocks: sudo, rm -rf /, curl|sh, fork bombs
- Path traversal protection in file tools
- Grep pattern length limits (ReDoS protection)

## 📦 Project Structure

```
horus/
├── src/
│   ├── cli-enhanced.ts      # Main CLI entry
│   ├── agent-enhanced.ts    # Core agent logic
│   ├── kimi.ts              # Kimi API client
│   ├── skills/              # Skill system
│   │   ├── generator.ts     # AI code generation
│   │   ├── registry.ts      # Skill lifecycle
│   │   └── types.ts         # Type definitions
│   ├── swarm/               # Multi-agent orchestration
│   │   ├── orchestrator.ts  # Swarm coordination
│   │   ├── subagent.ts      # Individual subagent
│   │   └── types.ts
│   ├── tools/               # Tool implementations
│   │   ├── batcher.ts       # MoE batching
│   │   ├── skill.ts         # Skill management tools
│   │   └── ...
│   ├── hibernation.ts       # State save/restore
│   └── ...
├── dist/                    # Compiled output
├── TODO.md                  # Development roadmap
├── HANDOFF.md               # Project handoff doc
└── README.md                # This file
```

## 🔧 Development

```bash
# Run tests
npm test

# Type checking
npm run typecheck

# Build
npm run build

# Development mode
npm run dev
```

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file.

## 🙏 Acknowledgments

- Inspired by [Nous Research's Hermes Agent](https://github.com/alchaincyf/hermes-agent-orange-book)
- Built for [Kimi K2.5](https://www.moonshot.cn/)'s 256K context and MoE architecture
- Architecture influenced by Claude Code and OpenClaw

---

<div align="center">
  <sub>Built with ❤️ for the AI-native coding future</sub>
</div>
