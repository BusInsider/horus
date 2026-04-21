#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const outputFile = path.join(outputDir, 'result.txt');

function main() {
  try {
    // Check if agent output mentions git status of horus
    const files = fs.readdirSync(outputDir);
    let agentOutput = '';
    
    for (const f of files) {
      if (f.startsWith('agent')) {
        agentOutput += fs.readFileSync(path.join(outputDir, f), 'utf-8');
      }
    }
    
    // Success if it found git info about horus
    const hasHorusPath = agentOutput.includes('/home/jackm/.hermes/workspace/horus');
    const hasGitInfo = agentOutput.includes('modified') || 
                       agentOutput.includes('staged') || 
                       agentOutput.includes('untracked') ||
                       agentOutput.includes('clean') ||
                       agentOutput.includes('M ') ||
                       agentOutput.includes('?? ');
    
    const passed = hasHorusPath && hasGitInfo;
    
    console.log(JSON.stringify({
      passed,
      score: passed ? 1.0 : 0.0,
      details: { hasHorusPath, hasGitInfo }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
