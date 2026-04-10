# Horus Development Roadmap

> Last updated: 2026-04-10

---

## 🎯 Phase 2.5: Cleanup & Hardening (COMPLETE)

### Summary

Rigorous testing and cleanup completed between Phase 2 and Phase 3.

#### Bugs Fixed

| Issue | Fix |
|-------|-----|
| Mode help text outdated | Updated to show `fast\|balanced\|thorough\|swarm` |
| Tools could be disabled | Now ALWAYS enabled in all modes |
| Temperature inconsistent | `balanced` mode: 0.8, `thorough`: 1.0 |
| Skill JSON invalid | Fixed csv_parser skill file |

#### Build Status
```
✅ npm run build     - PASS (3.1MB bundle)
⚠️  npm run typecheck - 6 pre-existing errors (legacy code)
✅ npm test          - 39/39 tests pass
```

---

## 🚀 Phase 3: Evals Framework & Developer Experience

Based on ["Better Harness: A Recipe for Harness Hill-Climbing with Evals"](https://github.com/langchain-ai/deepagents/tree/main/examples/better-harness) by LangChain.

### Philosophy

> **Evals are training data for autonomous harness engineering.**

The flywheel: More usage → More traces → More evals → Better harness → More users

### Phase 3.1: Trace Infrastructure

- [ ] **Session Trace Export**
  - `horus export-trace <session-id>` - Export full session trace
  - Include: messages, tool calls, timings, mode switches, errors
  - Format: JSON with standardized schema

- [ ] **Trace Storage**
  - Local: `~/.horus/traces/` directory
  - Organize by date/session for easy mining
  - Compression for old traces

- [ ] **Trace Viewer**
  - `horus trace view <session-id>` - Human-readable trace display
  - Show timing, token usage, decision points

### Phase 3.2: Evals System

- [ ] **Eval Categories** (tag everything)
  - `tool_selection` - Correct tool chosen for task
  - `file_operations` - Safe, correct file manipulations
  - `multi_step` - Complex multi-step reasoning
  - `error_recovery` - Graceful handling of failures
  - `context_management` - Proper token/compression handling
  - `mode_appropriateness` - Right mode for task type

- [ ] **Eval Format**
  ```yaml
  id: tool_selection_001
  category: tool_selection
  description: "Agent should use grep, not cat, for searching"
  input:
    prompt: "Find all TODO comments in src/"
    context: ["src/file1.ts", "src/file2.ts"]
  expected:
    tool_calls: ["grep"]
    not_tool_calls: ["cat", "view"]
  tags: ["search", "efficiency"]
  ```

- [ ] **Eval Storage**
  - `evals/` directory in repo
  - Subdirectories by category
  - Version controlled with git

### Phase 3.3: Eval Runner

- [ ] **CLI Commands**
  - `horus eval --list` - List all evals
  - `horus eval --category tool_selection` - Run category
  - `horus eval --tag efficiency` - Run by tag
  - `horus eval --run <eval-id>` - Run single eval
  - `horus eval --all` - Run full suite

- [ ] **Test Harness**
  - Run eval in isolated environment
  - Mock API responses for determinism
  - Record: pass/fail, tool calls, latency, token usage
  - Output: Detailed diff on failure

- [ ] **Holdout Sets**
  - Split evals: 80% optimization / 20% holdout
  - Never train on holdout
  - Measure generalization

### Phase 3.4: Harness Improvement Loop

- [ ] **Auto-Diagnosis**
  - Analyze failing evals for patterns
  - Cluster failures by root cause
  - Suggest harness changes

- [ ] **Prompt Optimization**
  - A/B test system prompt variants
  - Tool description improvements
  - Mode-specific instruction tuning

- [ ] **Regression Protection**
  - Evals that pass become permanent tests
  - CI runs evals on PR
  - Fail if any regression detected

### Phase 3.5: Production Integration

- [ ] **Trace Mining**
  - Automatically identify good/bad traces
  - Convert failures into eval candidates
  - User feedback integration (👍/👎)

- [ ] **Metrics Dashboard**
  - Pass rate over time
  - Category breakdown
  - Token efficiency by mode
  - Cost per eval

- [ ] **Continuous Improvement**
  - Weekly automated harness proposals
  - Human review before merge
  - Gradual rollout with canary testing

---

## 🚀 Phase 4: Skill Marketplace (Future)

- [ ] **Git-based Sharing**
  - `horus skill install github:user/repo`
  - Version pinning
  - Dependency resolution

- [ ] **Registry**
  - Central skill index
  - Search by tags/categories
  - Rating/review system

- [ ] **Skill Builder UI**
  - Interactive skill creation
  - Live testing environment
  - One-click publish

---

## 📊 Current Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | ✅ Complete | Core features |
| Phase 1.5 | ✅ Complete | Security, cleanup |
| Phase 1.7 | ✅ Complete | Skill system |
| Phase 2 | ✅ Complete | Batching, hibernation, swarm |
| Phase 2.5 | ✅ Complete | Testing, bug fixes |
| Phase 3.1 | ⏳ Planned | Trace infrastructure |
| Phase 3.2 | ⏳ Planned | Evals system |
| Phase 3.3 | ⏳ Planned | Eval runner |
| Phase 3.4 | ⏳ Planned | Improvement loop |
| Phase 3.5 | ⏳ Planned | Production integration |
| Phase 4 | ⏳ Future | Skill marketplace |

### Metrics

| Metric | Value |
|--------|-------|
| Build | ✅ Passing |
| Bundle | 3.1 MB |
| Tests | 39/39 pass |
| Type Errors | 6 (pre-existing) |
| Base Tools | 20 |
| Dynamic Skills | Unlimited |
| Evals | 0 (Phase 3 goal: 50+) |

---

## 🔗 Resources

- [Better Harness Article](https://blog.langchain.com/how-we-build-evals-for-deep-agents/)
- [Evals Framework Repo](https://github.com/langchain-ai/deepagents/tree/main/examples/better-harness)
- [Meta-Harness Paper](https://arxiv.org/abs/2603.28052)
- [Auto-Harness Paper](https://arxiv.org/pdf/2603.03329)
- [Audit Report](./AUDIT_REPORT.md)
- [Handoff Doc](./HANDOFF.md)
