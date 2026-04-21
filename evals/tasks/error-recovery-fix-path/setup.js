#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a subdirectory with the actual file
const subdir = path.join(workspaceDir, 'subdir');
fs.mkdirSync(subdir, { recursive: true });

fs.writeFileSync(path.join(subdir, 'data.txt'), 'This is the data file!\n');

console.log('Setup complete - file is in subdir/data.txt');
