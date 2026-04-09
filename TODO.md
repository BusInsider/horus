# Horus Development Roadmap

> Last updated: 2026-04-09

---

## 🎯 Phase 1.5: Cleanup & Hardening (ACTIVE)

### Post-Audit Findings

**Audit completed:** See `AUDIT_REPORT.md`

### 🔥 High Priority (Fix Before Phase 2)

- [ ] **Security Hardening**
  - [ ] Add input sanitization for grep patterns (regex DOS protection)
  - [ ] Add rate limiting for API calls
  - [ ] Add confirmation prompts for destructive operations (rm, edit)
  - [ ] Validate all file paths are within cwd
  - Files: `src/tools/*.ts`, `src/agent-enhanced.ts`

- [ ] **Code Cleanup**
  - [ ] Remove unused imports (~40 instances across codebase)
  - [ ] Delete `src/memory/v2/` (not integrated, not used)
  - [ ] Consolidate `src/agent.ts` into `src/agent-enhanced.ts`
  - [ ] Remove dead code from unused features
  - Files: Multiple

- [ ] **Error Handling**
  - [ ] Add comprehensive error boundaries
  - [ ] Implement structured logging system
  - [ ] Add graceful degradation for API failures
  - Files: `src/error-handler.ts`, `src/utils/logger.ts`

- [ ] **Testing**
  - [ ] Add integration tests for new tools (math, git, fetch, etc.)
  - [ ] Add mode switching tests
  - [ ] Add context loading tests
  - Target: 90%+ coverage

### Medium Priority

- [ ] **Documentation**
  - [ ] Document all 20 tools with examples
  - [ ] Add troubleshooting guide
  - [ ] Document Kimi-native features

---

## ✅ Phase 1: Kimi-Native Core (COMPLETE)

### Completed Features

- [x] **Four-Mode System** - instant/thinking/agent/swarm
- [x] **Interleaved Thinking Display** - --show-thinking flag
- [x] **Tool Registry** - 20 tools (expanded from 8)
- [x] **Prefix Caching** - Session ID for cache affinity
- [x] **256K Context** - Auto-load small projects
- [x] **Checkpoint System** - Git + snapshot rollback

### Audit Results
- Build: ✅ Passing
- TypeCheck: ✅ 95% clean
- Doctor: ✅ 20/20 checks pass
- Security: ✅ No critical issues
- Performance: ✅ Sub-second startup

---

## 🚀 Phase 2: Advanced Kimi Features (Pending Cleanup)

### 🔥 High Priority

- [ ] **Tool Call Batching (MoE Optimization)**
  - [ ] Batch parallel tool calls
  - [ ] Group by semantic similarity for expert clustering
  - [ ] Implement result aggregation
  - Files: `src/tools/batcher.ts`

- [ ] **Hibernation Architecture**
  - [ ] Checkpoint agent state (memory + context)
  - [ ] Resume from hibernation
  - [ ] Clone for MCTS-style exploration
  - Files: `src/hibernation.ts`

- [ ] **Agent Swarm (PARL)**
  - [ ] Orchestrator + sub-agent pattern
  - [ ] Self-organizing parallel execution
  - [ ] Shared message bus
  - Files: `src/swarm/orchestrator.ts`, `src/swarm/subagent.ts`

### Medium Priority

- [ ] **More Tools**
  - [ ] Docker tools (docker_ps, docker_logs, docker_exec)
  - [ ] Package managers (npm, pip, cargo)
  - [ ] Database tools (sqlite query)
  - [ ] AWS/GCP/Azure CLI wrappers
  - Target: 50+ tools total

---

## 🚀 Phase 3: Developer Experience

### Medium Priority

- [ ] **Configuration System**
  - [ ] `.horusrc` hierarchy (project, user, global)
  - [ ] Mode-specific settings
  - [ ] Tool enable/disable per project

- [ ] **Observability**
  - [ ] Token usage tracking
  - [ ] Cost estimation dashboard
  - [ ] Performance metrics
  - [ ] Cache hit rate monitoring

- [ ] **Editor Integration**
  - [ ] VS Code extension
  - [ ] File watcher for auto-reindex

---

## 📊 Current Status

| Metric | Value | Target |
|--------|-------|--------|
| Build | ✅ Passing | - |
| Type Coverage | ~90% | 95% |
| Test Pass Rate | 28/28 | 50+ |
| Tools | 20 | 50+ |
| Lines of Code | ~6,500 | <10K |
| Bundle Size | 3.1 MB | <5 MB |

---

## 📝 Recent Changes

### 2026-04-09: Phase 1 Complete + Audit
- Completed all Phase 1 features
- Fixed TypeScript errors from audit
- Security audit passed
- Performance tests passed
- Created AUDIT_REPORT.md

---

## 🔗 Resources

- [Audit Report](./AUDIT_REPORT.md)
- [Kimi Infrastructure Reference](./kimi%20infrastructure%20reference.txt)
- [Handoff Doc](./HANDOFF.md)
