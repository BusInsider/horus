#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a visible file to distract
fs.writeFileSync(
  path.join(workspaceDir, 'README.md'),
  '# Project README\n\nThis is a normal visible file.\n'
);

// Create the hidden config file
fs.writeFileSync(
  path.join(workspaceDir, '.hidden-config.yml'),
  'apiKey: sk-test-12345\ndatabase:\n  host: localhost\n  port: 5432\n'
);

console.log('Setup complete - hidden config file created');
