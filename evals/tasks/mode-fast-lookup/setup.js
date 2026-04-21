#!/usr/bin/env node
/**
 * Setup for mode-fast-lookup task
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

// Create workspace
fs.mkdirSync(workspaceDir, { recursive: true });

// Create config.json
const config = {
  name: "test",
  version: "1.0.0",
  setting: true
};

fs.writeFileSync(path.join(workspaceDir, 'config.json'), JSON.stringify(config, null, 2));
console.log('Setup complete');
