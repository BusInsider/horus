#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const checks = {};
    let score = 0;
    
    // Check required files exist
    const requiredFiles = ['validators.js', 'formatters.js', 'crypto-utils.js', 'http.js', 'index.js', 'utils.js'];
    for (const f of requiredFiles) {
      checks[f] = fs.existsSync(path.join(workspaceDir, f));
      if (checks[f]) score += 0.08;
    }
    
    // Check utils.js still works (backward compat)
    let backwardCompat = false;
    try {
      const utils = require(path.join(workspaceDir, 'utils.js'));
      backwardCompat = typeof utils.isEmail === 'function' && typeof utils.hash === 'function';
    } catch {}
    checks.backwardCompat = backwardCompat;
    if (backwardCompat) score += 0.15;
    
    // Check index.js re-exports
    let indexExports = false;
    try {
      const idx = require(path.join(workspaceDir, 'index.js'));
      indexExports = typeof idx.isEmail === 'function';
    } catch {}
    checks.indexExports = indexExports;
    if (indexExports) score += 0.1;
    
    // Check tests pass
    let testsPass = false;
    try {
      const { execSync } = require('child_process');
      execSync('npm test', { cwd: workspaceDir, encoding: 'utf-8', timeout: 5000 });
      testsPass = true;
    } catch {}
    checks.testsPass = testsPass;
    if (testsPass) score += 0.25;
    
    score = Math.min(score, 1.0);
    const passed = score >= 0.7;
    
    console.log(JSON.stringify({ passed, score, details: checks }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0, error: e.message }));
  }
}

main();
