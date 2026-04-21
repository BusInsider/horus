#!/usr/bin/env node
/**
 * Verifier for file-read-edit task
 * Returns JSON: { passed, score }
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const filePath = path.join(workspaceDir, 'data.txt');
    
    if (!fs.existsSync(filePath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'File not found' }));
      process.exit(0);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const hasOld = content.includes('OLD');
    const hasNew = content.includes('NEW');
    
    let score = 0.0;
    if (hasNew) {
      score = hasOld ? 0.5 : 1.0; // Partial if still has OLD
    }
    
    console.log(JSON.stringify({
      passed: score >= 0.9,
      score,
      details: { hasOld, hasNew }
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
