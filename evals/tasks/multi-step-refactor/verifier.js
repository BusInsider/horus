#!/usr/bin/env node
/**
 * Verifier for multi-step-refactor task
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const tsPath = path.join(workspaceDir, 'refactored.ts');
    
    if (!fs.existsSync(tsPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'refactored.ts not found' }));
      return;
    }
    
    const content = fs.readFileSync(tsPath, 'utf-8');
    
    // Check criteria
    const checks = {
      hasTypes: /:\s*(number|string|any)\b/.test(content) || /interface\s+\w+/.test(content),
      usesImport: /^(import|export)\b/m.test(content),
      hasErrorHandling: /try\s*\{|catch\s*\(|throw\s+/.test(content),
      hasCalc: /calc\s*\(/.test(content),
      hasGreet: /greet\s*\(/.test(content)
    };
    
    const score = Object.values(checks).filter(Boolean).length / 5;
    
    console.log(JSON.stringify({
      passed: score >= 0.8,
      score,
      details: checks
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
