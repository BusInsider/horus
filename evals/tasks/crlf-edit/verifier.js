#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const filePath = path.join(workspaceDir, 'config.txt');
    if (!fs.existsSync(filePath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'config.txt not found' }));
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const hasDebugFalse = content.includes('DEBUG=false');
    const noDebugTrue = !content.includes('DEBUG=true');
    const hasName = content.includes('NAME=MyApp');
    const hasPort = content.includes('PORT=3000');
    
    const score = (hasDebugFalse ? 0.4 : 0) + (noDebugTrue ? 0.3 : 0) + (hasName ? 0.15 : 0) + (hasPort ? 0.15 : 0);
    const passed = score >= 0.85;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { hasDebugFalse, noDebugTrue, hasName, hasPort, raw: content }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
