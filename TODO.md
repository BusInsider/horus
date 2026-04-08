# Horus Development Roadmap

> Last updated: 2026-04-08

## 🎯 Current Sprint: Claude Code Architecture Adoption

### ✅ Completed (High Priority)

- [x] **Tool Concurrency Classification**
  - [x] Classify tools as READ_ONLY vs WRITE vs BLOCKING
  - [x] Run READ_ONLY tools in parallel (up to 10)
  - [x] Run WRITE tools serially
  - [x] Implement tool orchestration layer
  - [x] Add result budgeting (truncate large outputs)
  - [x] Add tests
  - Files: `src/tools/orchestrator.ts`, `src/__tests__/tool-orchestrator.test.ts`

- [x] **System Prompt Caching**
  - [x] Split system prompt into static/dynamic sections
  - [x] Add SYSTEM_PROMPT_DYNAMIC_BOUNDARY marker
  - [x] Keep static content stable for API caching
  - [x] Move dynamic context to user message with <system-reminder> tags
  - [x] Add prompt cache manager
  - [x] Add tests
  - Files: `src/prompt-cacher.ts`, `src/__tests__/prompt-cacher.test.ts`

- [x] **Streaming Tool Executor**
  - [x] Parse tool calls incrementally during streaming
  - [x] Start tool execution mid-stream (before model finishes)
  - [x] Queue tools for parallel/serial execution
  - [x] Handle sibling abort (fail fast on parallel tool errors)
  - [x] Handle streaming fallback to non-streaming
  - [x] Add idle timeout watchdog
  - [x] Add tests
  - Files: `src/streaming-executor.ts`, `src/__tests__/streaming-executor.test.ts`

### 🔥 High Priority (Next)

- [ ] **Integrate new features into Agent Loop**
  - [ ] Replace existing tool execution with orchestrator
  - [ ] Add prompt caching to system prompt generation
  - [ ] Enable streaming tool executor
  - [ ] Benchmark performance improvements
  - Target: 2-5x speedup on multi-tool turns, 80% cache hit rate

### 🚀 Medium Priority (Backlog)

- [ ] **Four-Phase Compaction Hierarchy**
  - Phase 1: Microcompact (every turn, cached tool results)
  - Phase 2: Snip (truncate old messages)
  - Phase 3: Auto-compact (summarize with model)
  - Phase 4: Context collapse (staged compression)
  - Implement "protected tail" concept

- [ ] **Enhanced Retry System**
  - Specific recovery for each HTTP error code
  - 429: Respect Retry-After, exponential backoff
  - 529: Track consecutive, fallback model
  - 400: Context overflow handling
  - Network errors: Disable keep-alive, reconnect

- [ ] **.horusrc Hierarchy**
  - /etc/horus/horusrc (enterprise)
  - .horus/horusrc (project)
  - ~/.horus/horusrc (user)
  - .horusrc.local (local, gitignored)
  - @include directive for composition

### 💡 Low Priority (Icebox)

- [ ] **7-Stage Permission System**
- [ ] **Skills System**
- [ ] **UI Improvements**
- [ ] **Multi-model support**

---

## 📊 Current Status

| Metric | Value |
|--------|-------|
| Lines of Code | ~5,000 |
| Test Suites | 6 |
| Tests Passing | 28 |
| Build Time | ~85ms |
| Bundle Size | 3.1 MB |

---

## 📝 Recent Changes

### 2026-04-08: Claude Code Architecture Features
- Implemented tool concurrency classification (read-only parallel, write serial)
- Implemented system prompt caching with dynamic boundary
- Implemented streaming tool executor with mid-stream execution
- Added 15 new tests for the above features

### 2026-04-08: Type System Fixes
- Fixed ToolResult discriminated union type usage
- Fixed all TypeScript errors in new modules
- Removed require() imports from logger, crypto

---

## 🔗 Related Resources

- [Claude Code Architecture Analysis](./output.txt) - Full PDF text extraction
- [Memory v2.0 Spec](./MEMORY_V2_INTEGRATION.md)
- [Issues Breakdown](./ISSUES_BREAKDOWN.md)
