#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const foundPath = path.join(workspaceDir, 'found-config.txt');
    const hiddenPath = path.join(workspaceDir, '.hidden-config.yml');
    
    if (!fs.existsSync(foundPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'found-config.txt not found' }));
      return;
    }
    
    const hiddenContent = fs.readFileSync(hiddenPath, 'utf-8').trim();
    const foundContent = fs.readFileSync(foundPath, 'utf-8').trim();
    
    // Check exact match (allow minor whitespace differences)
    const exactMatch = foundContent === hiddenContent;
    const normalizedMatch = foundContent.replace(/\s+/g, ' ').trim() === hiddenContent.replace(/\s+/g, ' ').trim();
    
    const hasKey = foundContent.includes('apiKey: sk-test-12345');
    const hasDb = foundContent.includes('database:') && foundContent.includes('localhost');
    
    const score = exactMatch ? 1.0 : (normalizedMatch ? 1.0 : (hasKey && hasDb ? 0.5 : 0.0));
    const passed = score >= 0.9;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { exactMatch, hasKey, hasDb }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
