# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-04-18

### Added - K2.6 Support
- Added `kimi-k2-6` and `kimi-k2-6-preview` model identifiers
- Updated Kimi coding endpoint mapping to support K2.6 variants
- Updated `doctor` validation to recognize K2.6 models

### Fixed - Type Safety & Build
- Fixed 10 TypeScript errors across 6 files (typecheck now passes cleanly)
- Fixed `session-archive.ts` gunzip using wrong zlib API (`createGunzip` → `gunzip`)
- Fixed missing `crypto` import in `session-archive.ts`
- Fixed `configure.ts` missing `verbosity` property in reset config
- Fixed `doctor.ts` private property access (`results` → `getResults()`)
- Fixed `mcp/client.ts` `unknown` → `boolean` cast
- Removed unused imports/variables in `grep.ts` and `terminal.ts`

### Fixed - Tool Bugs
- **Bash security**: `rm -rf /tmp/safe_path` no longer falsely triggers "System-wide deletion"
  - Root deletion patterns now only match actual system dirs (`/bin`, `/etc`, `/usr`, etc.)
- **Memory recall**: Lowered default `recallThreshold` from 0.7 to 0.5
  - Fixes issue where legitimate semantic queries returned no results
- **Search tools**: Relative paths in `search` and `git` tools now resolve against `context.cwd`

## [0.2.0] - 2026-04-09

### Added - Phase 2: Advanced Features

#### Tool Call Batching (MoE Optimization)
- Semantic clustering of tool calls (filesystem, network, git, data, memory, skills)
- Dependency resolution with topological sort
- Parallel execution within batches using `Promise.allSettled`
- MoE-optimized batch sizing (max 8 per batch)
- Usage statistics and performance tracking

#### Hibernation Architecture
- Full agent state serialization (messages, SQLite DB, context)
- Checkpoint save/restore functionality
- Clone capability for MCTS-style exploration
- Parent/child relationship tracking
- Compression support for checkpoints
- CLI commands: `horus hibernation list`, `horus hibernation delete`

#### Agent Swarm (PARL)
- Multi-agent orchestration using PARL pattern (Planning, Acting, Reflecting, Learning)
- Automatic task decomposition using LLM
- Parallel subagent execution with dependency resolution
- Shared message bus for inter-agent communication
- Result aggregation and synthesis
- Configurable strategies: hierarchical, flat, mesh
- CLI commands: `horus swarm execute`, `horus swarm status`

#### Skill System (Phase 1.7)
- AI-powered dynamic skill generation
- Skill registry with lifecycle management
- 6 skill management tools: `skill_list`, `skill_create`, `skill_view`, `skill_delete`, `skill_evolve`, `skill_stats`
- Versioning with automatic semver on evolution
- Persistence to `~/.horus/skills/{builtin,user,community}/`
- Security validation (blocks eval, new Function, require)
- Example built-in skill: `csv_parser`

### Added - Security Hardening
- Dangerous command detection in bash tool (sudo, rm -rf, curl|sh, fork bombs)
- Grep pattern length limits (1000 chars) for ReDoS protection
- Path traversal validation in file tools
- Input sanitization for skill code generation

### Changed
- Updated `KimiClient.complete()` to return full response object instead of just string
- Fixed 40+ TypeScript unused variable warnings
- Improved type safety across codebase
- Fixed `in` operator bug → `includes()` in agent loader

### Fixed
- SSE parsing edge cases in `src/kimi.ts`
- Type mismatches in Float32Array vs number[] conversions
- Import path issues in skills and swarm modules
- ToolContext.env optional property added

### Removed
- Dead code: `src/agent.ts` (superseded by agent-enhanced)
- Dead code: `src/memory/v2/` directory (unused)

## [0.1.0] - 2026-04-05

### Added - Phase 1: Core Features

#### Four-Mode System
- **Instant Mode**: Temperature 0.6, no tools, fastest responses ($0.60/M)
- **Thinking Mode**: Temperature 1.0, no tools, reasoning focus ($0.60/M)
- **Agent Mode**: Temperature 1.0, full tool access ($3.00/M)
- **Swarm Mode**: Multi-agent coordination

#### Interleaved Thinking Display
- `--show-thinking` flag for displaying reasoning_content
- TerminalUI support for thinking output

#### Tool Registry
- 20 base tools (expanded from 8):
  - File: view, edit, cat, ls, mkdir, rm, glob
  - Search: search, grep
  - Git: git_status, git_diff, git_log
  - Data: fetch, json_parse, json_format, math
  - Memory: recall, remember, index

#### Memory System
- SQLite-based episodic memory
- Semantic search with embeddings
- Working memory management
- Codebase indexing via `index_workspace`

#### Checkpoint System
- Git-based rollback
- File snapshot rollback (for non-git directories)
- Checkpoint creation and restoration

#### Prefix Caching
- X-Session-Id header for cache affinity
- Session ID format: `horus_a2...`

#### 256K Context Support
- Auto-loads small codebases into context
- Token management and validation

### Infrastructure
- Kimi API client with streaming support
- Terminal UI with proper input handling
- Configuration system (`~/.horus/config.json`)
- Doctor diagnostics
- Session management
- Plan mode with structured execution
- MCP (Model Context Protocol) support
- GitHub integration (PRs, issues)

---

## Release Notes

### v0.2.0 - "The Swarm Update"

This release brings Horus from a single-agent system to a multi-agent platform with dynamic capabilities. The three major features (batching, hibernation, swarm) work together to enable complex workflows:

1. **Tool Batching** makes single-agent operations more efficient on Kimi's MoE architecture
2. **Hibernation** enables stateful multi-turn workflows and experimentation
3. **Swarm** enables parallel execution of complex objectives

The Skill System makes Horus extensible without code changes - the AI can generate its own tools.

**Bundle Size**: 3.1 MB  
**Build Time**: ~100ms  
**Test Pass Rate**: 39/39  

### v0.1.0 - "The Foundation"

Initial release with core Kimi-native features. Established the four-mode system and memory architecture that future releases build upon.

---

## Roadmap

### Phase 3 (Planned)
- Skill Marketplace (git-based sharing)
- Observability Dashboard (token tracking, costs)
- Additional base tools (Docker, package managers)

See [TODO.md](TODO.md) for detailed roadmap.
