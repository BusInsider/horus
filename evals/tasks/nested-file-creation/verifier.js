#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    // Check agent output for bash usage
    let agentOutput = '';
    const files = fs.readdirSync(outputDir);
    for (const f of files) {
      if (f.startsWith('agent')) {
        agentOutput += fs.readFileSync(path.join(outputDir, f), 'utf-8');
      }
    }
    const usedBash = agentOutput.includes('[bash:');
    
    const filePath = path.join(workspaceDir, 'src', 'components', 'Button.tsx');
    const fileExists = fs.existsSync(filePath);
    
    if (!fileExists) {
      console.log(JSON.stringify({ 
        passed: false, 
        score: 0.0, 
        details: { fileExists, usedBash, error: 'Button.tsx not found' }
      }));
      return;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const hasExport = content.includes('export');
    const hasButton = content.includes('Button');
    const hasJSX = content.includes('<button>');
    
    if (usedBash) {
      console.log(JSON.stringify({ 
        passed: false, 
        score: 0.0, 
        details: { fileExists, usedBash, hasExport, hasButton, hasJSX, error: 'Used bash commands' }
      }));
      return;
    }
    
    const score = (hasExport ? 0.33 : 0) + (hasButton ? 0.33 : 0) + (hasJSX ? 0.34 : 0);
    const passed = score >= 0.9;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { fileExists, usedBash, hasExport, hasButton, hasJSX }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
