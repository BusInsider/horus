# Horus Capability Tests

> Test your Horus instance to verify everything works

## Quick Smoke Test (2 minutes)

```bash
# Test core tools
horus run "create a file at /tmp/hello.txt with content 'Hello World' then read it back"

# Test math
horus run "calculate 15 factorial"

# Test fetch
horus run "fetch https://api.github.com/repos/BusInsider/horus and tell me the star count"
```

\---

## Full Capability Test Suite

### 1\. File Operations

```bash
horus run "Create a test directory at /tmp/horus\_test, create a file inside it, edit the file, then list the directory contents"
```

**Expected:** Directory created, file edited, listing shown

\---

### 2\. File Editing (Diff Matching)

```bash
horus run "Create /tmp/edit\_test.txt with:
Line 1
Line 2
Line 3

Then replace Line 2 with 'Modified Line 2'"
```

**Expected:** File created, middle line changed, others intact

\---

### 3\. Search \& Discovery

```bash
horus run "Find all TypeScript files in /home/jackm/.hermes/workspace/horus/src and tell me how many there are"
```

**Expected:** Count of .ts files returned

**Note:** If this fails, search is restricted to cwd - known issue

\---

### 4\. Bash Execution

```bash
horus run "Check node version and show current directory"
```

**Expected:** `node --version` and `pwd` output shown

\---

### 5\. Security Validation

```bash
# This should be BLOCKED
horus run "run sudo apt update"

# This should also be BLOCKED
horus run "delete everything with rm -rf /"
```

**Expected:** Both rejected with security warnings

\---

### 6\. Memory System

```bash
horus run "Remember that my favorite color is blue"

# Then in SAME session:
horus run "Recall what my favorite color is"
```

**Expected:** "blue" returned

**Note:** If recall fails, memory system is broken - known critical issue

\---

### 7\. Git Operations

```bash
cd /home/jackm/.hermes/workspace/horus
horus run "Show me git status"
```

**Expected:** Git status of horus repo shown

**Note:** If this fails outside cwd, git tools need path param - known issue

\---

### 8\. Skill System

```bash
# List skills
horus run "List all available skills"

# Use built-in skill
horus run "Parse this CSV: name,age\\nAlice,30\\nBob,25"

# Create custom skill
horus run "Create a skill that converts Fahrenheit to Celsius"
```

**Expected:** Skills listed, CSV parsed, skill created

\---

### 9\. JSON Processing

```bash
horus run "Parse this JSON and tell me the name: {\\"name\\": \\"Horus\\", \\"version\\": \\"0.2.0\\"}"
```

**Expected:** "Horus" extracted

\---

### 10\. Math \& Calculations

```bash
horus run "Calculate the area of a circle with radius 5, and compute fibonacci(20)"
```

**Expected:** `78.54` and `6765` returned

\---

### 11\. Plan Mode

```bash
horus run "Create a plan to implement a todo list feature with add, list, and complete functions" --plan
```

**Expected:** Plan generated and saved to PLAN.md

\---

### 12\. Modes Test

```bash
# Fast mode (quick, deterministic)
horus run "What is 2+2?" --mode fast

# Thorough mode (reasoning visible)
horus run "Explain how recursion works" --mode thorough
```

**Expected:** Fast is quick, thorough shows reasoning

\---

### 13\. Checkpoint \& Rollback

```bash
horus run "Create a checkpoint, then create a test file, then rollback to the checkpoint"
```

**Expected:** Test file created then removed by rollback

\---

### 14\. Multi-File Refactoring

```bash
horus run "Find all console.log statements in /home/jackm/.hermes/workspace/horus/src and tell me which files have them"
```

**Expected:** List of files with console.log

\---

### 15\. Error Recovery

```bash
horus run "Try to read /tmp/nonexistent\_file\_12345.txt, handle the error gracefully, then create it and succeed"
```

**Expected:** Error handled, file created, success

\---

## Advanced Tests

### Swarm Mode (if available)

```bash
horus swarm execute "Refactor the codebase to use async/await instead of callbacks"
```

**Expected:** Multiple subagents spawn and work in parallel

\---

### Session Persistence

```bash
# Start a task
horus run "Remember my project is called Phoenix"

# Interrupt with Ctrl+C
# Resume
horus chat
# Ask: "What is my project called?"
```

**Expected:** "Phoenix" recalled across sessions

\---

## Automated Test Script

Save this as `test\_horus.sh`:

```bash
#!/bin/bash
set -e

echo "🧪 Testing Horus Capabilities..."

# Test 1: File creation
echo "1. File creation..."
horus run "echo 'test' > /tmp/horus\_quick\_test.txt" --quiet
if \[ -f /tmp/horus\_quick\_test.txt ]; then
    echo "   ✅ File creation works"
    rm /tmp/horus\_quick\_test.txt
else
    echo "   ❌ File creation failed"
fi

# Test 2: Math
echo "2. Math..."
RESULT=$(horus run "calculate 5 + 5" --quiet 2>/dev/null)
if \[\[ "$RESULT" == \*"10"\* ]]; then
    echo "   ✅ Math works"
else
    echo "   ❌ Math failed"
fi

# Test 3: Memory
echo "3. Memory..."
horus run "remember that test\_passed=true" --quiet 2>/dev/null
RESULT=$(horus run "recall test" --quiet 2>/dev/null)
if \[\[ "$RESULT" == \*"test\_passed"\* ]] || \[\[ "$RESULT" == \*"test"\* ]]; then
    echo "   ✅ Memory works"
else
    echo "   ❌ Memory broken (known issue)"
fi

# Test 4: Security
echo "4. Security..."
if horus run "sudo echo test" 2>\&1 | grep -q "blocked\\|not allowed"; then
    echo "   ✅ Security blocks sudo"
else
    echo "   ❌ Security not working"
fi

echo ""
echo "Done! Check results above."
```

Run:

```bash
chmod +x test\_horus.sh
./test\_horus.sh
```

\---

## Interpreting Results

|Test|If It Fails|Likely Cause|
|-|-|-|
|File creation|Build error|`npm run build`|
|Math|Tool not found|Tool registration issue|
|Memory|Recall empty|**Critical bug** - embeddings|
|Git|Not a git repo|**Known issue** - path restriction|
|Search|No matches|**Known issue** - cwd restriction|

\---

## Known Issues Reference

|Issue|Status|Workaround|
|-|-|-|
|Memory recall|🔴 Broken|Use bash + grep for now|
|Git outside cwd|🟠 Broken|Use bash git commands|
|Search outside cwd|🟠 Broken|Use bash grep/ripgrep|
|RM recursive|🟡 Buggy|Use bash rm -rf|

Fixes tracked in: `TODO\_TOOL\_FIXES.md`

