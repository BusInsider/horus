#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const calcPath = path.join(workspaceDir, 'calculator.js');
    const testPath = path.join(workspaceDir, 'test-calculator.js');
    
    if (!fs.existsSync(calcPath) || !fs.existsSync(testPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'Missing files' }));
      return;
    }
    
    // Run tests
    let testPassed = false;
    try {
      const output = execSync('node test-calculator.js', {
        cwd: workspaceDir,
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      testPassed = output.includes('All tests passed!');
    } catch (e) {
      testPassed = false;
    }
    
    // Verify multiply is fixed
    const calcContent = fs.readFileSync(calcPath, 'utf-8');
    const multiplyFixed = calcContent.includes('multiply') && 
      (calcContent.match(/function multiply\s*\([^)]*\)\s*\{[\s\S]*?return a \* b;[\s\S]*?\}/) ||
       calcContent.includes('return a * b') ||
       calcContent.includes('return b * a'));
    
    const score = testPassed ? 1.0 : (multiplyFixed ? 0.5 : 0.0);
    const passed = testPassed;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { testPassed, multiplyFixed }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
