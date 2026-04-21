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
    
    // Check for the recalled information
    const hasTypeScript = lower.includes('typescript') || lower.includes('type script');
    const hasVSCode = lower.includes('vs code') || lower.includes('vscode') || lower.includes('visual studio code');
    
    // Check that it used memory
    const usedMemory = lower.includes('memory') || lower.includes('remember') || lower.includes('recall');
    
    const passed = hasTypeScript && hasVSCode;
    const score = (hasTypeScript ? 0.5 : 0) + (hasVSCode ? 0.5 : 0);
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { hasTypeScript, hasVSCode, usedMemory }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
