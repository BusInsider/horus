#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    // Check that utils/logger.js exists
    const loggerPath = path.join(workspaceDir, 'utils', 'logger.js');
    const hasLogger = fs.existsSync(loggerPath);
    
    let loggerContent = '';
    if (hasLogger) {
      loggerContent = fs.readFileSync(loggerPath, 'utf-8');
    }
    
    // Check that files import the logger
    const files = ['file1.js', 'file2.js', 'file3.js'];
    let importCount = 0;
    let removedConsoleLog = 0;
    
    for (const f of files) {
      const filePath = path.join(workspaceDir, f);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        
        // Check for import/require of logger
        if (content.includes('logger') || content.includes("require('./utils/logger')") || content.includes("require('../utils/logger')")) {
          importCount++;
        }
        
        // Check that old console.log pattern is reduced
        const consoleLogCount = (content.match(/console\.log/g) || []).length;
        if (consoleLogCount <= 1) { // Allow at most 1 (for testing or edge cases)
          removedConsoleLog++;
        }
      }
    }
    
    const score = (hasLogger ? 0.4 : 0) + (importCount / 3 * 0.4) + (removedConsoleLog / 3 * 0.2);
    const passed = hasLogger && importCount >= 2 && removedConsoleLog >= 2;
    
    console.log(JSON.stringify({
      passed,
      score: Math.min(score, 1.0),
      details: { hasLogger, importCount, removedConsoleLog }
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
