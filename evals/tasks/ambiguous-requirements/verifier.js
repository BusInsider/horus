#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    // Recursively find all files
    function findFiles(dir, base = '') {
      const results = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = path.join(base, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          results.push(...findFiles(path.join(dir, entry.name), relPath));
        } else if (entry.isFile()) {
          results.push(relPath);
        }
      }
      return results;
    }

    const allFiles = findFiles(workspaceDir);
    const files = allFiles.map(f => path.basename(f));
    const codeFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.py') || f.endsWith('.go'));

    let score = 0;
    const checks = {};

    // Check 1: At least 2 code files created (showing initiative)
    checks.minFiles = codeFiles.length >= 2;
    if (checks.minFiles) score += 0.15;

    // Check 2: Some kind of notification module exists
    const hasNotificationFile = files.some(f => f.toLowerCase().includes('notif'));
    checks.hasNotificationFile = hasNotificationFile;
    if (hasNotificationFile) score += 0.15;

    // Check 3: Has some notion of different notification types
    let hasTypes = false;
    for (const f of codeFiles) {
      const content = fs.readFileSync(path.join(workspaceDir, f), 'utf-8').toLowerCase();
      if (content.includes('email') || content.includes('sms') || content.includes('push') ||
          content.includes('type') || content.includes('channel') || content.includes('priority')) {
        hasTypes = true;
        break;
      }
    }
    checks.hasTypes = hasTypes;
    if (hasTypes) score += 0.2;

    // Check 4: Has some form of error handling or validation
    let hasErrorHandling = false;
    for (const f of codeFiles) {
      const content = fs.readFileSync(path.join(workspaceDir, f), 'utf-8');
      if (content.includes('try') || content.includes('catch') || content.includes('throw') ||
          content.includes('validate') || content.includes('error')) {
        hasErrorHandling = true;
        break;
      }
    }
    checks.hasErrorHandling = hasErrorHandling;
    if (hasErrorHandling) score += 0.15;

    // Check 5: Has a README or comments documenting assumptions
    const hasReadme = files.some(f => f.toLowerCase().includes('readme') || f.toLowerCase().includes('md'));
    let hasComments = false;
    for (const f of codeFiles) {
      const content = fs.readFileSync(path.join(workspaceDir, f), 'utf-8');
      if (content.includes('//') || content.includes('/*')) {
        hasComments = true;
        break;
      }
    }
    checks.documented = hasReadme || hasComments;
    if (checks.documented) score += 0.15;

    // Check 6: Exports a usable API (CommonJS or ESM)
    let hasExports = false;
    for (const f of codeFiles) {
      const content = fs.readFileSync(path.join(workspaceDir, f), 'utf-8');
      if (content.includes('module.exports') || content.includes('exports.') || content.includes('export ')) {
        hasExports = true;
        break;
      }
    }
    checks.hasExports = hasExports;
    if (hasExports) score += 0.2;

    score = Math.min(score, 1.0);
    const passed = score >= 0.6;

    console.log(JSON.stringify({ passed, score, details: checks }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0, error: e.message }));
  }
}

main();
