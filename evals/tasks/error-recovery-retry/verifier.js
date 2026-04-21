#!/usr/bin/env node
/**
 * Verifier for error-recovery-retry task
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const dataDir = path.join(workspaceDir, 'data');
    const resultPath = path.join(workspaceDir, 'total_lines.txt');
    
    if (!fs.existsSync(resultPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'total_lines.txt not found' }));
      return;
    }
    
    // Calculate expected total (non-empty lines only)
    let expectedTotal = 0;
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
        expectedTotal += content.split('\n').filter(line => line.trim()).length;
      }
    }
    
    // Parse result
    const resultContent = fs.readFileSync(resultPath, 'utf-8').trim();
    const resultMatch = resultContent.match(/(\d+)/);
    const resultTotal = resultMatch ? parseInt(resultMatch[1]) : 0;
    
    const correct = resultTotal === expectedTotal;
    
    console.log(JSON.stringify({
      passed: correct,
      score: correct ? 1.0 : 0.0,
      details: { expectedTotal, resultTotal }
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
