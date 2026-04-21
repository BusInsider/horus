#!/usr/bin/env node
/**
 * Setup for tool-selection-grep task
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

// Create workspace
fs.mkdirSync(workspaceDir, { recursive: true });

// Create logs.txt with many lines, some with ERROR
const lines = [];
for (let i = 0; i < 1000; i++) {
  if (i % 100 === 0) {
    lines.push(`${new Date().toISOString()} ERROR: Something went wrong at step ${i}`);
  } else {
    lines.push(`${new Date().toISOString()} INFO: Normal operation at step ${i}`);
  }
}

fs.writeFileSync(path.join(workspaceDir, 'logs.txt'), lines.join('\n'));
console.log('Setup complete');
