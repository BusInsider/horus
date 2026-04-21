#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');

function main() {
  try {
    // Read agent output
    const files = fs.readdirSync(outputDir);
    let agentOutput = '';
    
    for (const f of files) {
      if (f.startsWith('agent')) {
        agentOutput += fs.readFileSync(path.join(outputDir, f), 'utf-8');
      }
    }
    
    const lower = agentOutput.toLowerCase();
    
    // Check if it found and read the file
    const hasDataContent = lower.includes('this is the data file') || 
                           lower.includes('data file');
    
    // Check if it handled the error gracefully
    const handledError = lower.includes('not found') || 
                         lower.includes('error') || 
                         lower.includes('try') ||
                         lower.includes('found');
    
    const passed = hasDataContent;
    const score = hasDataContent ? 1.0 : (handledError ? 0.3 : 0.0);
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { hasDataContent, handledError }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
