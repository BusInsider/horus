#!/usr/bin/env node
/**
 * Verifier for large-context-bug-hunt
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const processorPath = path.join(workspaceDir, 'src', 'processor.js');
    
    if (!fs.existsSync(processorPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'processor.js not found' }));
      return;
    }
    
    const content = fs.readFileSync(processorPath, 'utf-8');
    
    // Check that the bug is fixed: processBatch should use batch.length not this.batchSize
    const bugFixed = content.includes('new Array(batch.length)') || 
                     content.includes('results = batch.map') ||
                     content.includes('const results = [];') ||
                     !content.includes('new Array(this.batchSize)');
    
    // Run the test suite
    let testPassed = false;
    try {
      execSync('node test/runner.js', { cwd: workspaceDir, encoding: 'utf-8', timeout: 10000 });
      testPassed = true;
    } catch {
      testPassed = false;
    }
    
    const checks = {
      bugFixed,
      testPassed
    };
    
    const score = Object.values(checks).filter(Boolean).length / 2;
    
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
