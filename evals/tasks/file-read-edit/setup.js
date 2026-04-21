#!/usr/bin/env node
/**
 * Setup for file-read-edit task
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

// Create workspace
fs.mkdirSync(workspaceDir, { recursive: true });

// Create data.txt with OLD text
const content = `This is a test file.
It contains the word OLD that needs to be replaced.
There are multiple OLD words in this file.
`;

fs.writeFileSync(path.join(workspaceDir, 'data.txt'), content);
console.log('Setup complete');
