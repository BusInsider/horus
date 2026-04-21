#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Broken calculator
fs.writeFileSync(
  path.join(workspaceDir, 'calculator.js'),
  `function add(a, b) {\n  return a + b;\n}\n\nfunction multiply(a, b) {\n  return a + b;  // BUG: should multiply\n}\n\nmodule.exports = { add, multiply };\n`
);

// Tests
fs.writeFileSync(
  path.join(workspaceDir, 'test-calculator.js'),
  `const { add, multiply } = require('./calculator');\n\nlet passed = true;\n\nif (add(2, 3) !== 5) {\n  console.log('FAIL: add(2, 3) should be 5');\n  passed = false;\n}\n\nif (multiply(4, 5) !== 20) {\n  console.log('FAIL: multiply(4, 5) should be 20');\n  passed = false;\n}\n\nif (multiply(0, 100) !== 0) {\n  console.log('FAIL: multiply(0, 100) should be 0');\n  passed = false;\n}\n\nif (passed) {\n  console.log('All tests passed!');\n} else {\n  console.log('Some tests failed.');\n  process.exit(1);\n}\n`
);

console.log('Setup complete - calculator with bug ready');
