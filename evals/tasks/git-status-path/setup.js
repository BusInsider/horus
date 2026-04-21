#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a non-git directory
fs.writeFileSync(path.join(workspaceDir, 'README.txt'), 'This is not a git repo\n');

console.log('Setup complete - workspace is not a git repo');
