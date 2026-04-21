#!/usr/bin/env node
/**
 * Horus Eval Runner
 *
 * Usage:
 *   node scripts/eval-runner.js --quick          # Run quick eval set
 *   node scripts/eval-runner.js --full           # Run all tasks
 *   node scripts/eval-runner.js --task <name>    # Run specific task
 *   node scripts/eval-runner.js --list           # List available tasks
 *
 * Exit codes:
 *   0 = All passed
 *   1 = Some failed
 *   2 = Error
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolve paths relative to project root (scripts/ is in project root)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(PROJECT_ROOT, 'evals', 'tasks');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'evals', 'output');
const HORUS_BIN = path.join(PROJECT_ROOT, 'dist', 'cli-enhanced.js');

// Quick set for rapid iteration (9 tasks)
const QUICK_TASKS = [
  'file-read-edit',
  'tool-selection-grep',
  'error-recovery-retry',
  'multi-step-refactor',
  'mode-fast-lookup',
  'git-status-path',
  'search-outside-cwd',
  'memory-recall',
  'nested-file-creation'
];

// Full test suite (all tasks)
const FULL_TASKS = [
  ...QUICK_TASKS,
  'multi-file-refactor',
  'complex-plan',
  'error-recovery-fix-path',
  'large-repo-focus',
  'self-correction',
  'cross-session-context',
  'crlf-edit',
  'hidden-config-discovery',
  'large-context-bug-hunt',
  'ambiguous-error-recovery',
  'cross-file-type-refactor',
  'deliberate-plan-flaws',
  // 'nested-conditional-editing'  // Flaky: agent loop/API issues, revisit later
];

function log(message) {
  console.log(`[${new Date().toISOString().split('T')[1].slice(0,8)}] ${message}`);
}

function runCommand(cmd, cwd, timeout = 60000) {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { success: true, output, code: 0 };
  } catch (e) {
    return {
      success: false,
      output: e.stdout || '',
      error: e.stderr || e.message,
      code: e.status || 1
    };
  }
}

async function discoverTasks(filter = null) {
  const tasks = [];
  const entries = fs.readdirSync(TASKS_DIR);

  for (const entry of entries) {
    const taskDir = path.join(TASKS_DIR, entry);
    const taskToml = path.join(taskDir, 'task.toml');

    if (fs.existsSync(taskToml)) {
      if (!filter || filter.includes(entry)) {
        tasks.push(entry);
      }
    }
  }

  return tasks;
}

async function listTasks() {
  const tasks = await discoverTasks();
  console.log('\nAvailable Eval Tasks:\n');

  const categories = new Map();
  for (const taskName of tasks) {
    const taskDir = path.join(TASKS_DIR, taskName);
    const taskToml = path.join(taskDir, 'task.toml');
    let tags = [];
    if (fs.existsSync(taskToml)) {
      const tomlContent = fs.readFileSync(taskToml, 'utf-8');
      const tagsMatch = tomlContent.match(/tags\s*=\s*\[([^\]]+)\]/);
      if (tagsMatch) {
        tags = tagsMatch[1].split(',').map(t => t.trim().replace(/"/g, ''));
      }
    }
    const category = tags[0] || 'uncategorized';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push({ name: taskName, tags });
  }

  for (const [category, items] of categories) {
    console.log(`  ${category}:`);
    for (const item of items) {
      const inQuick = QUICK_TASKS.includes(item.name) ? ' [quick]' : '';
      console.log(`    - ${item.name}${inQuick}`);
    }
  }
  console.log('');
}

async function setupTask(taskName) {
  const taskDir = path.join(TASKS_DIR, taskName);
  const setupScript = path.join(taskDir, 'setup.js');
  const outputDir = path.join(OUTPUT_DIR, taskName);
  const workspaceDir = path.join(outputDir, 'workspace');

  // Clean and recreate workspace
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(workspaceDir, { recursive: true });

  // Run setup if exists
  if (fs.existsSync(setupScript)) {
    const result = runCommand(`node "${setupScript}" "${workspaceDir}"`, __dirname, 30000);
    if (!result.success) {
      log(`Setup warning for ${taskName}: ${result.error}`);
    }
  }

  return { workspaceDir, outputDir };
}

async function runTask(taskName, workspaceDir, outputDir) {
  const taskDir = path.join(TASKS_DIR, taskName);
  const instructionPath = path.join(taskDir, 'instruction.md');

  // Read instruction first
  const instruction = fs.readFileSync(instructionPath, 'utf-8');

  // Read task config
  const taskToml = path.join(taskDir, 'task.toml');
  let timeout = 120000; // Default 120s (API calls can take time)
  let usePlanMode = false;

  if (fs.existsSync(taskToml)) {
    const tomlContent = fs.readFileSync(taskToml, 'utf-8');
    const timeoutMatch = tomlContent.match(/timeout\s*=\s*(\d+)/);
    if (timeoutMatch) {
      timeout = parseInt(timeoutMatch[1]) * 1000;
    }
    if (tomlContent.includes('use_plan_mode') || tomlContent.includes('plan_mode_required')) {
      usePlanMode = true;
    }
  }

  // Also check instruction for explicit plan mode request
  // Only trigger if explicitly requested, not if negated (e.g. "Do NOT use plan mode")
  if (instruction.includes('--plan')) {
    usePlanMode = true;
  }
  if (/\b(use|enable|run with|start)\s+plan\s+mode\b/i.test(instruction)) {
    usePlanMode = true;
  }

  // Run horus CLI as subprocess
  const startTime = Date.now();

  // Write instruction to temp file and create a shell script to run horus
  const instructionFile = path.join(outputDir, '.instruction.txt');
  fs.writeFileSync(instructionFile, instruction);

  const planFlag = usePlanMode ? ' --plan' : '';

  // Create isolated config for this task to prevent memory pollution
  const isolatedConfigDir = path.join(workspaceDir, '.horus');
  fs.mkdirSync(isolatedConfigDir, { recursive: true });

  // Read user config if available
  let apiKey = process.env.KIMI_API_KEY || '';
  let baseUrl = 'https://api.moonshot.ai/v1';
  let model = 'kimi-k2-5';
  const userConfigPath = path.join(require('os').homedir(), '.horus', 'config.json');
  if (fs.existsSync(userConfigPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
      apiKey = userConfig.provider?.apiKey || apiKey;
      baseUrl = userConfig.provider?.baseUrl || baseUrl;
      model = userConfig.provider?.model || model;
    } catch {}
  }

  // Create isolated config with task-specific memory DB
  const isolatedConfig = {
    provider: { apiKey, model, baseUrl },
    memory: {
      dbPath: path.join(isolatedConfigDir, 'memory.db'),
      embeddingModel: 'Xenova/all-MiniLM-L6-v2',
      maxWorkingTokens: 50000,
      recallThreshold: 0.5,
      maxRecalledMemories: 10
    },
    agent: { mode: 'semi', maxIterations: 50, showMemoryOperations: true, verbosity: 'normal' },
    workspace: { defaultPath: workspaceDir, autoIndex: true }
  };
  fs.writeFileSync(path.join(isolatedConfigDir, 'config.json'), JSON.stringify(isolatedConfig, null, 2));

  const shellScript = `#!/bin/bash
# Use isolated home directory so ~/.horus resolves to workspace
export HOME="${workspaceDir.replace(/"/g, '\\"')}"
INSTRUCTION=$(cat '${instructionFile.replace(/'/g, "'\\''")}')
node "${HORUS_BIN.replace(/"/g, '\\"')}" run --fresh --path "${workspaceDir.replace(/"/g, '\\"')}"${planFlag} "$INSTRUCTION"
`;
  const shellScriptPath = path.join(outputDir, 'run.sh');
  fs.writeFileSync(shellScriptPath, shellScript);
  fs.chmodSync(shellScriptPath, 0o755);

  const result = runCommand(`bash "${shellScriptPath}"`, workspaceDir, timeout);

  const elapsed = Date.now() - startTime;

  // Save output
  fs.writeFileSync(path.join(outputDir, 'agent_output.txt'), result.output);
  if (result.error) {
    fs.writeFileSync(path.join(outputDir, 'agent_error.txt'), result.error);
  }

  // Run verifier
  const verifierPath = path.join(taskDir, 'verifier.js');
  let score = 0.0;
  let passed = false;
  let details = {};

  if (fs.existsSync(verifierPath)) {
    const verifyResult = runCommand(`node "${verifierPath}" "${outputDir}"`, __dirname, 10000);
    try {
      const verification = JSON.parse(verifyResult.output);
      score = verification.score || 0.0;
      passed = verification.passed || score >= 0.9;
      details = verification.details || {};
    } catch (e) {
      log(`Verification parse failed for ${taskName}: ${e.message}`);
      details = { parseError: true, raw: verifyResult.output };
    }
  } else {
    // No verifier - assume pass if horus exited cleanly
    passed = result.success;
    score = result.success ? 1.0 : 0.0;
  }

  // Extract performance metrics from agent output
  const metrics = extractMetrics(result.output);

  return {
    name: taskName,
    score,
    passed,
    elapsed,
    details,
    metrics,
    output: result.output.slice(0, 500) // Truncate for logging
  };
}

function extractMetrics(output) {
  const metrics = {
    iterations: null,
    tokens: null,
    apiCalls: null
  };

  // Parse session summary line: [Session ended] — 12 iterations, 8,492 tokens
  const sessionEndMatch = output.match(/Session ended.*?(\d+)\s+iterations[,\s]*([\d,]+)\s+tokens/i);
  if (sessionEndMatch) {
    metrics.iterations = parseInt(sessionEndMatch[1], 10);
    metrics.tokens = parseInt(sessionEndMatch[2].replace(/,/g, ''), 10);
  }

  // Count API calls as proxy for iterations (fallback)
  const apiCallMatches = output.match(/\[Calling API with \d+ messages\.\.\.\]/g);
  if (apiCallMatches) {
    metrics.apiCalls = apiCallMatches.length;
    if (metrics.iterations === null) {
      metrics.iterations = metrics.apiCalls;
    }
  }

  return metrics;
}

function printResults(results) {
  console.log('\n' + '='.repeat(70));
  console.log('EVAL RESULTS');
  console.log('='.repeat(70));

  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    const score = (r.score * 100).toFixed(0);
    const iter = r.metrics?.iterations !== null ? `${r.metrics.iterations}it` : '';
    const tok = r.metrics?.tokens !== null ? `${(r.metrics.tokens / 1000).toFixed(1)}kt` : '';
    const extra = [iter, tok].filter(Boolean).join(' ');
    const extraPad = extra ? `  ${extra}` : '';
    console.log(`${icon} ${r.name.padEnd(25)} ${score.padStart(3)}%  ${r.elapsed.toString().padStart(5)}ms${extraPad}`);
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / total;
  const avgTime = results.reduce((sum, r) => sum + r.elapsed, 0) / total;
  const avgIter = results.filter(r => r.metrics?.iterations !== null).reduce((sum, r, _, arr) => sum + (r.metrics?.iterations || 0) / arr.length, 0);

  console.log('-'.repeat(70));
  console.log(`Total: ${passed}/${total} passed (${(passed/total*100).toFixed(0)}%)`);
  console.log(`Avg Score: ${(avgScore * 100).toFixed(1)}%`);
  console.log(`Avg Time: ${avgTime.toFixed(0)}ms`);
  if (avgIter > 0) {
    console.log(`Avg Iterations: ${avgIter.toFixed(1)}`);
  }
  console.log('='.repeat(70));
}

async function saveResults(results, outputPath) {
  const resultsPath = outputPath || path.join(PROJECT_ROOT, 'evals', 'results.json');
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8'
    }).trim();
  } catch {}

  const data = {
    timestamp: new Date().toISOString(),
    commit,
    results
  };
  fs.writeFileSync(resultsPath, JSON.stringify(data, null, 2));
  return resultsPath;
}

async function main() {
  const args = process.argv.slice(2);

  // Check binary exists
  if (!fs.existsSync(HORUS_BIN)) {
    console.error(`Horus binary not found at ${HORUS_BIN}`);
    console.error('Run "npm run build" first.');
    process.exit(2);
  }

  if (args.includes('--list')) {
    await listTasks();
    process.exit(0);
  }

  let tasks = [];

  if (args.includes('--quick')) {
    tasks = QUICK_TASKS;
    log(`Running QUICK eval (${tasks.length} tasks)...`);
  } else if (args.includes('--full')) {
    tasks = FULL_TASKS;
    log(`Running FULL eval (${tasks.length} tasks)...`);
  } else if (args.includes('--task')) {
    const idx = args.indexOf('--task');
    tasks = [args[idx + 1]];
    log(`Running single task: ${tasks[0]}`);
  } else if (args.includes('--output')) {
    // --output is a modifier, not a primary command
    const idx = args.indexOf('--output');
    const outputPath = args[idx + 1];
    if (!outputPath) {
      console.error('Usage: --output <path>');
      process.exit(2);
    }
    // Default to full suite if only --output given
    tasks = FULL_TASKS;
    log(`Running FULL eval (${tasks.length} tasks) with output to ${outputPath}...`);
  } else {
    console.log('Horus Eval Runner');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/eval-runner.js --quick      # Fast feedback (9 tasks)');
    console.log('  node scripts/eval-runner.js --full       # All tasks (17 tasks)');
    console.log('  node scripts/eval-runner.js --task NAME  # Specific task');
    console.log('  node scripts/eval-runner.js --list       # List available tasks');
    console.log('  node scripts/eval-runner.js --output PATH [--quick|--full]  # Save results to path');
    console.log('');
    process.exit(2);
  }

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Run tasks
  const results = [];
  for (const taskName of tasks) {
    process.stdout.write(`[....] ${taskName.padEnd(25)} `);
    const { workspaceDir, outputDir } = await setupTask(taskName);
    const result = await runTask(taskName, workspaceDir, outputDir);
    results.push(result);

    const icon = result.passed ? 'PASS' : 'FAIL';
    const score = (result.score * 100).toFixed(0);
    process.stdout.write(`\r[${icon}] ${taskName.padEnd(25)} ${score.padStart(3)}%\n`);
  }

  printResults(results);
  const savedPath = await saveResults(results, outputPath);
  if (outputPath) {
    log(`Results saved to: ${savedPath}`);
  }

  // Exit with error if any failed
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(2);
});
