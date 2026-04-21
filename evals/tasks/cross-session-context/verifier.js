#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const configPath = path.join(workspaceDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'config.json not found' }));
      return;
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    const checks = {
      apiBaseUrl: config.apiBaseUrl === 'https://api.example.com/v2',
      defaultTimeout: config.defaultTimeout === 30000 || config.defaultTimeout === '30000',
      featureFlag: config.featureFlag === 'enable-beta-dashboard'
    };
    
    const correctCount = Object.values(checks).filter(Boolean).length;
    const score = correctCount / 3;
    const passed = score >= 0.67;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: { ...checks, rawConfig: config }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
