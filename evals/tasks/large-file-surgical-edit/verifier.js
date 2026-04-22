#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const serverPath = path.join(workspaceDir, 'server.js');
    
    if (!fs.existsSync(serverPath)) {
      console.log(JSON.stringify({ passed: false, score: 0, details: { error: 'server.js not found' } }));
      return;
    }
    
    const content = fs.readFileSync(serverPath, 'utf-8');
    const lines = content.split('\n');
    
    let score = 0;
    const checks = {};
    
    // Check 1: file still has ~5000 lines (not reformatted/rewritten)
    checks.preservedLength = lines.length >= 2000;
    if (checks.preservedLength) score += 0.15;
    
    // Check 2: checkRateLimit still exists
    checks.functionExists = content.includes('function checkRateLimit(clientId, maxRequests = 100, windowMs = 60000)');
    if (checks.functionExists) score += 0.15;
    
    // Check 3: sliding window implementation (not fixed window)
    checks.noFixedWindow = !content.includes('Math.floor(now / windowMs) * windowMs');
    if (checks.noFixedWindow) score += 0.2;
    
    // Check 4: uses timestamps/array for sliding window
    checks.slidingLogic = content.includes('Date.now()') && 
      (content.includes('filter') || content.includes('push') || content.includes('splice') || content.includes('timestamp') || content.includes('now - windowMs'));
    if (checks.slidingLogic) score += 0.2;
    
    // Check 5: run tests
    let testsPass = false;
    try {
      const { execSync } = require('child_process');
      execSync('npm test', { cwd: workspaceDir, encoding: 'utf-8', timeout: 5000 });
      testsPass = true;
    } catch {
      testsPass = false;
    }
    checks.testsPass = testsPass;
    if (testsPass) score += 0.3;
    
    const passed = score >= 0.7;
    
    console.log(JSON.stringify({
      passed,
      score: Math.min(score, 1.0),
      details: checks
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0, error: e.message }));
  }
}

main();
