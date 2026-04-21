#!/usr/bin/env node
/**
 * Verifier for mode-fast-lookup task
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const configPath = path.join(workspaceDir, 'config.json');
    
    // Check if file exists (agent might have modified it, but we check content was read)
    if (!fs.existsSync(configPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'config.json not found' }));
      return;
    }
    
    // For this task, we just check the file exists and has valid JSON
    // The "verification" is that the agent successfully read it
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    
    const valid = config.name === 'test' && config.version === '1.0.0';
    
    console.log(JSON.stringify({
      passed: valid,
      score: valid ? 1.0 : 0.0,
      details: { hasName: !!config.name, hasVersion: !!config.version }
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
