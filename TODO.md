# Horus Development Roadmap

> Last updated: 2026-04-09

## 🎯 Current Focus: Kimi-Native Architecture

Based on Kimi's infrastructure reference, Horus should leverage Kimi's unique capabilities rather than copying Claude-centric patterns.

---

## 🚀 Phase 1: Kimi-Native Core (Active)

### 🔥 High Priority (Next Up)

- [x] **Four-Mode System** (`--mode` CLI flag) ✅
  - [x] `instant` mode: temp=0.6, thinking=disabled - quick responses, $0.60/M
  - [x] `thinking` mode: temp=1.0, thinking=enabled - complex reasoning
  - [x] `agent` mode: temp=1.0, tools enabled - multi-tool workflows (default)
  - [x] `swarm` mode: parallel sub-agents - batch processing
  - Files: `src/mode-controller.ts`, `src/cli-enhanced.ts`

- [ ] **Interleaved Thinking Display**
  - [ ] Capture `reasoning_content` separately from `content`
  - [ ] Stream reasoning in gray/dim text (optional --show-thinking flag)
  - [ ] Store reasoning in memory for context
  - Files: `src/kimi.ts`, `src/agent-enhanced.ts`, `src/ui/terminal.ts`

- [x] **Expand Tool Registry (128 Tool Support)** ✅ Phase 1
  - [x] Expanded from 8 to 20 tools
  - [x] New tools: cat, ls, mkdir, rm, grep, git_status, git_diff, git_log, fetch, json_parse, json_format, math
  - [ ] Phase 2: Add more specialized tools (docker, npm, python, etc.)
  - Files: `src/tools/*.ts`

- [x] **Prefix Caching Optimization** ✅
  - [x] Added `X-Session-Id` header for cache affinity
  - [x] Session ID stays consistent across requests
  - Files: `src/kimi.ts`

### ✅ Recently Completed

- [x] **Basic Chat Working**
  - [x] SSE parsing fixed (data: vs data: )
  - [x] AI responds to messages
  - [x] Session management

- [x] **Tool Execution Working**
  - [x] ReAct loop functional
  - [x] view, edit, bash, search tools work
  - [x] Tool results feed back to AI
  - [x] Error handling allows recovery

---

## 🚀 Phase 2: Advanced Kimi Features

### Medium Priority

- [ ] **256K Context Optimization**
  - [ ] Load entire codebase into context (skip RAG for small projects)
  - [ ] Context budget manager (reserve 56K for output)
  - [ ] Auto-detect when to use full context vs selective loading
  - [ ] Files: `src/context-loader.ts`

- [ ] **Tool Call Batching (MoE Optimization)**
  - [ ] Batch parallel tool calls to maximize expert utilization
  - [ ] Group by semantic similarity for expert clustering
  - [ ] Files: `src/tools/batcher.ts`

- [ ] **Hibernation Architecture**
  - [ ] Checkpoint agent state (memory + context)
  - [ ] Resume from hibernation
  - [ ] Clone for exploration (MCTS-style parallel rollouts)
  - [ ] Files: `src/hibernation.ts`

- [ ] **Agent Swarm (PARL)**
  - [ ] Orchestrator + sub-agent pattern
  - [ ] Self-organizing (no pre-defined workflows)
  - [ ] Parallel execution with shared message bus
  - [ ] Files: `src/swarm/orchestrator.ts`, `src/swarm/subagent.ts`

---

## 🚀 Phase 3: Claude Code Integration (Paused)

These features were designed for Claude but may not be optimal for Kimi. Re-evaluate after Phase 1.

### On Hold

- [ ] ~~Tool Concurrency Classification~~ - Kimi handles this natively
- [ ] ~~System Prompt Caching~~ - Use prefix caching instead
- [ ] ~~Streaming Tool Executor~~ - Kimi's RL training handles this
- [ ] ~~Four-Phase Compaction~~ - 256K context reduces need

---

## 🚀 Phase 4: Developer Experience

### Medium Priority

- [ ] **Configuration**
  - [ ] `.horusrc` hierarchy (project, user, global)
  - [ ] Mode-specific settings
  - [ ] Tool enable/disable per project

- [ ] **Observability**
  - [ ] Token usage tracking
  - [ ] Cost estimation
  - [ ] Cache hit rate metrics
  - [ ] Performance profiling

- [ ] **Checkpoint System**
  - [ ] Git-based checkpoints
  - [ ] Rollback UI
  - [ ] Checkpoint on edit operations

---

## 📊 Current Status

| Metric | Value | Target |
|--------|-------|--------|
| Lines of Code | ~6,000 | - |
| Tests Passing | 28 | 50+ |
| Build Time | ~100ms | <100ms |
| Bundle Size | 3.1 MB | <5 MB |
| Tools Registered | 8 | 50+ |
| Context Window | 256K | Fully utilized |
| Modes Supported | 0 | 4 |

---

## 📝 Recent Changes

### 2026-04-09: Chat + Tool Execution Working
- Fixed SSE parsing bug (data: vs data: )
- Fixed reasoning_content requirement for tool calls
- Fixed duplicate assistant message bug
- Fixed tool error handling to continue conversation
- AI can now use tools and chain tool calls

### 2026-04-08: Kimi Infrastructure Research
- Reviewed Kimi's native agent infrastructure
- Identified key differentiators from Claude-centric harnesses
- 128 tools vs 10-20, 256K context, hibernation, MoE optimization

---

## 🔗 Key Resources

- [Kimi Infrastructure Reference](./kimi%20infrastructure%20reference.txt) - Kimi's native patterns
- [HANDOFF.md](./HANDOFF.md) - Project overview
- [START_HERE.md](./START_HERE.md) - Quick start

---

## 🎯 Next Immediate Task

**Implement Four-Mode System**

```bash
horus chat --mode instant    # Quick responses, cheapest
horus chat --mode thinking   # Complex reasoning
horus chat --mode agent      # Multi-tool (default)
horus chat --mode swarm      # Parallel batch processing
```

This enables cost optimization and leverages Kimi's native training for different modes.
