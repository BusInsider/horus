#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Nothing special to set up - testing memory system
fs.writeFileSync(path.join(workspaceDir, 'README.txt'), 'Memory test - remember user preferences\n');

console.log('Setup complete');
