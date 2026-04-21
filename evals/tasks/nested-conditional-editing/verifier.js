#!/usr/bin/env node
/**
 * Verifier for nested-conditional-editing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const authPath = path.join(workspaceDir, 'src', 'auth.js');
    
    if (!fs.existsSync(authPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'auth.js not found' }));
      return;
    }
    
    const content = fs.readFileSync(authPath, 'utf-8');
    const lines = content.split('\n');
    
    // Check nesting depth: no line should start with more than 2 levels of indentation
    // (assuming 2 spaces per indent)
    let maxIndent = 0;
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('if ') || trimmed.startsWith('} else')) {
        const indent = line.length - trimmed.length;
        maxIndent = Math.max(maxIndent, indent);
      }
    }
    
    // 2 levels = 4 spaces (function body) + 2 spaces = 6? No, let's count actual braces
    // Actually, let's count opening braces after if statements
    let nestingDepth = 0;
    let maxNesting = 0;
    for (const line of lines) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      nestingDepth += openBraces - closeBraces;
      maxNesting = Math.max(maxNesting, nestingDepth);
    }
    
    // Original had nesting depth of ~8. We want max 3 (function + 2 levels).
    const nestingOk = maxNesting <= 3;
    
    // Run tests
    let testsPassed = false;
    try {
      execSync('npm test', { cwd: workspaceDir, encoding: 'utf-8', timeout: 10000 });
      testsPassed = true;
    } catch {
      testsPassed = false;
    }
    
    // Check early returns are used
    const hasEarlyReturns = content.includes('return { allowed: false');
    
    const checks = {
      nestingOk,
      testsPassed,
      hasEarlyReturns
    };
    
    const score = Object.values(checks).filter(Boolean).length / 3;
    
    console.log(JSON.stringify({
      passed: score >= 1.0,
      score,
      details: checks
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
