#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a file with CRLF line endings
const content = 'NAME=MyApp\r\nDEBUG=true\r\nPORT=3000\r\n';
fs.writeFileSync(path.join(workspaceDir, 'config.txt'), content);

console.log('Setup complete - CRLF config file created');
