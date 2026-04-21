#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create files with duplicated logging
const file1 = `function doSomething() {
  console.log('Starting doSomething');
  console.log('Doing work...');
  console.log('Finished doSomething');
  return 42;
}

module.exports = { doSomething };
`;

const file2 = `function doOtherThing() {
  console.log('Starting doOtherThing');
  console.log('Processing...');
  console.log('Finished doOtherThing');
  return 'done';
}

module.exports = { doOtherThing };
`;

const file3 = `function doThirdThing() {
  console.log('Starting doThirdThing');
  console.log('Working...');
  console.log('Finished doThirdThing');
  return true;
}

module.exports = { doThirdThing };
`;

fs.writeFileSync(path.join(workspaceDir, 'file1.js'), file1);
fs.writeFileSync(path.join(workspaceDir, 'file2.js'), file2);
fs.writeFileSync(path.join(workspaceDir, 'file3.js'), file3);

console.log('Setup complete - 3 files with duplicated logging created');
