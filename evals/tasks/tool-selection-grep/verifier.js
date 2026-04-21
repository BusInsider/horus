#!/usr/bin/env node
/**
 * Verifier for tool-selection-grep task
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const logsPath = path.join(workspaceDir, 'logs.txt');
    const errorsPath = path.join(workspaceDir, 'errors.txt');
    
    if (!fs.existsSync(errorsPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'errors.txt not found' }));
      return;
    }
    
    // Read original logs to count ERROR lines
    const logsContent = fs.readFileSync(logsPath, 'utf-8');
    const expectedErrors = logsContent.split('\n').filter(line => line.includes('ERROR')).length;
    
    // Check errors.txt
    const errorsContent = fs.readFileSync(errorsPath, 'utf-8');
    const foundErrors = errorsContent.split('\n').filter(line => line.includes('ERROR')).length;
    
    const score = foundErrors / expectedErrors;
    
    console.log(JSON.stringify({
      passed: score >= 0.9,
      score,
      details: { expectedErrors, foundErrors }
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
