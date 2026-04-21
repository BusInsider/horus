#!/usr/bin/env node
/**
 * Setup for multi-step-refactor task
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

// Create workspace
fs.mkdirSync(workspaceDir, { recursive: true });

// Create old_code.js
const jsCode = `
function calc(a, b) {
  return a + b;
}

function greet(name) {
  if (!name) {
    throw new Error("Name required");
  }
  return "Hello, " + name;
}

module.exports = { calc, greet };
`;

fs.writeFileSync(path.join(workspaceDir, 'old_code.js'), jsCode.trim());
console.log('Setup complete');
