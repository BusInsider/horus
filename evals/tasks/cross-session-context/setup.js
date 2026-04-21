#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create some distracting files
fs.writeFileSync(path.join(workspaceDir, 'README.md'), '# Project\n\nWelcome!\n');
fs.writeFileSync(path.join(workspaceDir, 'package.json'), '{"name": "test-project"}\n');

// Create a nested hidden directory with session notes
const sessionDir = path.join(workspaceDir, '.session-history', '2026-04-10');
fs.mkdirSync(sessionDir, { recursive: true });

fs.writeFileSync(
  path.join(sessionDir, 'session-notes.md'),
  `# Session Notes — 2026-04-10

## Decisions
- API base URL: https://api.example.com/v2
- Default timeout: 30000ms
- Feature flag: enable-beta-dashboard

## TODO
- Update docs
- Add tests
`
);

// Add some other notes to distract
fs.writeFileSync(
  path.join(workspaceDir, 'notes.txt'),
  'Random scratchpad notes. Nothing important here.'
);

console.log('Setup complete - session notes hidden in workspace');
