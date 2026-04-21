#!/usr/bin/env node
/**
 * Setup for error-recovery-retry task
 * Creates data directory and files
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
const dataDir = path.join(workspaceDir, 'data');

// Create directories
fs.mkdirSync(dataDir, { recursive: true });

// Create some txt files
fs.writeFileSync(path.join(dataDir, 'a.txt'), 'Line 1\nLine 2\nLine 3\n');
fs.writeFileSync(path.join(dataDir, 'b.txt'), 'Line 1\nLine 2\n');
fs.writeFileSync(path.join(dataDir, 'c.txt'), 'Line 1\n');

console.log('Setup complete');
