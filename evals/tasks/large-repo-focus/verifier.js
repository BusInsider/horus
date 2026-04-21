#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const answerPath = path.join(workspaceDir, 'answer.txt');
    if (!fs.existsSync(answerPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'answer.txt not found' }));
      return;
    }
    
    const answer = fs.readFileSync(answerPath, 'utf-8').trim();
    const expected = 'monorepo/packages/billing/services/shipping.ts';
    
    const correct = answer === expected || answer.endsWith('billing/services/shipping.ts');
    const score = correct ? 1.0 : 0.0;
    
    console.log(JSON.stringify({
      passed: correct,
      score,
      details: { answer, expected }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
