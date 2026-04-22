#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const checks = {};
    let score = 0;
    
    // Check 1: card-validation.js has logger.info
    const cardSrc = fs.readFileSync(path.join(workspaceDir, 'card-validation.js'), 'utf-8');
    checks.cardLogged = cardSrc.includes('logger.info');
    if (checks.cardLogged) score += 0.25;
    
    // Check 2: charge-processor.js has logger.info
    const chargeSrc = fs.readFileSync(path.join(workspaceDir, 'charge-processor.js'), 'utf-8');
    checks.chargeLogged = chargeSrc.includes('logger.info');
    if (checks.chargeLogged) score += 0.25;
    
    // Check 3: receipt-sender.js has logger.info
    const receiptSrc = fs.readFileSync(path.join(workspaceDir, 'receipt-sender.js'), 'utf-8');
    checks.receiptLogged = receiptSrc.includes('logger.info');
    if (checks.receiptLogged) score += 0.25;
    
    // Check 4: tests pass
    let testsPass = false;
    try {
      const { execSync } = require('child_process');
      execSync('npm test', { cwd: workspaceDir, encoding: 'utf-8', timeout: 5000 });
      testsPass = true;
    } catch {}
    checks.testsPass = testsPass;
    if (testsPass) score += 0.25;
    
    score = Math.min(score, 1.0);
    const passed = score >= 0.75;
    
    console.log(JSON.stringify({ passed, score, details: checks }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0, error: e.message }));
  }
}

main();
