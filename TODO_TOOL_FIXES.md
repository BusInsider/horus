# Horus Tool Fixes - Post-Audit Action Items

> Generated from Horus self-test run on 2026-04-10

## 🔴 CRITICAL - Fix Immediately

### 1. Memory Recall System Broken
**Problem:** `remember` stores facts (verified in DB), but `recall` returns no results
**Root Cause:** Embedding generation or similarity search failing
**Evidence:** 2 facts in DB with embedding blobs, but `recall query=test suite` finds nothing

**Fix Steps:**
- [ ] Debug `src/tools/memory.ts` - `recall` function
- [ ] Check embedding model is generating vectors (not zeros/nulls)
- [ ] Verify similarity threshold (0.7) isn't too strict
- [ ] Test with `sqlite-vec` directly: `SELECT vec_distance_cosine(embedding, ?)`
- [ ] Add debug logging to recall query

**Test:**
```bash
horus run "remember that I like pizza, then recall what food I like"
```

---

## 🟠 HIGH - Fix This Week

### 2. Git Tools CWD Restriction
**Problem:** `git_status`, `git_log`, `git_diff` only work in exact cwd, don't find `.git` in parent dirs
**Impact:** Can't use git tools in subdirectories of a repo

**Fix Steps:**
- [ ] Add optional `path` parameter to all git tools (default: cwd)
- [ ] Walk up directory tree to find `.git` if not in cwd
- [ ] Update tool schemas in `src/tools/git.ts`

**Test:**
```bash
mkdir -p /tmp/test_repo/subdir && cd /tmp/test_repo && git init
horus run "cd subdir && check git status" --path /tmp/test_repo
```

### 3. Search Tools Path Restriction  
**Problem:** `grep` and `search` fail with "Path must be within working directory" for paths outside cwd
**Impact:** Can't search in parent directories or other project locations

**Fix Steps:**
- [ ] Add `path` parameter to `grep` and `search` tools
- [ ] Validate path is within allowed roots (security)
- [ ] Update `src/tools/grep.ts` and `src/tools/search.ts`

**Test:**
```bash
horus run "search for TODO in /home/jackm/.hermes/workspace/horus/src"
```

---

## 🟡 MEDIUM - Fix When Convenient

### 4. RM Tool Recursive Parameter
**Problem:** `rm` with `recursive: true` sometimes receives `undefined` instead of boolean
**Impact:** Tool fails with "options.recursive must be of type boolean"

**Fix Steps:**
- [ ] Ensure schema validates `recursive` is strictly boolean
- [ ] Add default value `false` in tool definition
- [ ] Check `src/tools/fileops.ts` - `rm` function

**Test:**
```bash
horus run "create /tmp/test_dir/file.txt then remove /tmp/test_dir recursively"
```

### 5. Bash Security Overly Aggressive
**Problem:** `rm -rf /tmp/safe_path` triggers "System-wide deletion" warning incorrectly
**Impact:** Legitimate cleanup commands blocked

**Fix Steps:**
- [ ] Tune dangerous pattern detection in `src/tools/bash.ts`
- [ ] Allow `rm -rf` with specific paths (not just `/` or `/*`)
- [ ] Add whitelist for `/tmp/`, `~/.cache/`, etc.

**Test:**
```bash
horus run "remove /tmp/test_cleanup_folder recursively"
```

---

## 🟢 NICE TO HAVE

### 6. Tool Error Messages
**Problem:** CWD restriction errors don't explain *why* or suggest fix
**Fix:** Add helpful messages like: "Search limited to /home/jackm/workspace. Use --path to change workspace."

### 7. Self-Test Command
**Problem:** No built-in way to verify tool health
**Fix:** Add `horus doctor --tools` that runs basic tests on each tool

---

## Quick Fixes (30 min each)

| Fix | File | Line | Change |
|-----|------|------|--------|
| Git path param | `src/tools/git.ts` | ~30 | Add `path?: string` to schema |
| Search path param | `src/tools/grep.ts` | ~25 | Add `path?: string` to schema |
| RM recursive default | `src/tools/fileops.ts` | ~200 | Add `default: false` |

---

## Verification Checklist

After each fix, run:
```bash
npm run build
horus run "test [specific tool]" --path /tmp
```

Then full test:
```bash
# From horus-meta
node evals/runner.js --quick
```

---

## Current Status

| Category | Working | Broken | Workaround |
|----------|---------|--------|------------|
| File Ops | ls, cat, view, mkdir, edit | rm (recursive) | Use bash for rm -rf |
| Search | glob | grep, search | Use bash grep |
| System | bash | - | - |
| Git | - | status, log, diff | Use bash git |
| Memory | remember, index | recall | Not usable |
| Skills | All | - | - |
| Data | math, json, fetch | - | - |

**Bottom Line:** 16/21 tools working (76%). Fix memory + git + search = 100% working.
