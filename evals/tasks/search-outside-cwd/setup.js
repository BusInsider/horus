#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a dummy file with no interfaces
fs.writeFileSync(path.join(workspaceDir, 'dummy.txt'), 'No interfaces here\n');

console.log('Setup complete');
