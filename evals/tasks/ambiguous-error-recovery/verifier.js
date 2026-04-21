#!/usr/bin/env node
/**
 * Verifier for ambiguous-error-recovery
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const configPath = path.join(workspaceDir, 'src', 'config.js');
    const apiPath = path.join(workspaceDir, 'src', 'api.js');
    
    if (!fs.existsSync(configPath) || !fs.existsSync(apiPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'missing files' }));
      return;
    }
    
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const apiContent = fs.readFileSync(apiPath, 'utf-8');
    
    // The correct fix is in config.js: port should be parsed as integer
    const rootCauseFixed = 
      configContent.includes('parseInt') ||
      configContent.includes('Number(') ||
      configContent.includes('+process.env.PORT') ||
      configContent.includes('port: 3000');
    
    // Penalize if they just patched api.js to coerce the port (symptom fix)
    const symptomPatchOnly = apiContent.includes('parseInt') || apiContent.includes('Number(');
    
    // Run tests
    let testPassed = false;
    try {
      execSync('npm test', { cwd: workspaceDir, encoding: 'utf-8', timeout: 15000 });
      testPassed = true;
    } catch {
      testPassed = false;
    }
    
    const checks = {
      rootCauseFixed,
      testPassed,
      noSymptomPatch: !symptomPatchOnly
    };
    
    const score = Object.values(checks).filter(Boolean).length / 3;
    
    console.log(JSON.stringify({
      passed: score >= 1.0,
      score,
      details: checks
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
