#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');

function main() {
  try {
    // Check agent output for interface matches
    const files = fs.readdirSync(outputDir);
    let agentOutput = '';
    
    for (const f of files) {
      if (f.startsWith('agent')) {
        agentOutput += fs.readFileSync(path.join(outputDir, f), 'utf-8');
      }
    }
    
    // Should find interfaces and mention horus/src
    const hasInterfaces = agentOutput.match(/interface\s+\w+/i);
    const hasHorusPath = agentOutput.includes('horus/src');
    const hasMatches = agentOutput.includes('Found') || agentOutput.includes('matches');
    
    const passed = hasInterfaces && hasHorusPath;
    
    console.log(JSON.stringify({
      passed,
      score: passed ? 1.0 : 0.0,
      details: { 
        hasInterfaces: !!hasInterfaces, 
        hasHorusPath,
        interfaceCount: hasInterfaces ? 1 : 0
      }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
