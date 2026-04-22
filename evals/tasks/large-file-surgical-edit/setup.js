#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a large server.js with ~5000 lines
const lines = [];

// Header
lines.push('// Large server simulation file');
lines.push('const http = require("http");');
lines.push('const url = require("url");');
lines.push('');

// Generate many placeholder functions to push checkRateLimit deep into the file
for (let i = 1; i <= 200; i++) {
  lines.push(`function helper${i}(x) { return x + ${i}; }`);
  lines.push(`function middleware${i}(req, res, next) {`);
  lines.push(`  req.id = helper${i}(Date.now());`);
  lines.push(`  next();`);
  lines.push(`}`);
  lines.push('');
}

// The buggy checkRateLimit function around line ~800-820
lines.push('const rateLimitStore = new Map();');
lines.push('');
lines.push('function checkRateLimit(clientId, maxRequests = 100, windowMs = 60000) {');
lines.push('  const now = Date.now();');
lines.push('  const windowStart = Math.floor(now / windowMs) * windowMs;');
lines.push('  const key = `${clientId}:${windowStart}`;');
lines.push('  const count = rateLimitStore.get(key) || 0;');
lines.push('  if (count >= maxRequests) {');
lines.push('    return { allowed: false, retryAfter: windowStart + windowMs - now };');
lines.push('  }');
lines.push('  rateLimitStore.set(key, count + 1);');
lines.push('  return { allowed: true, remaining: maxRequests - count - 1 };');
lines.push('}');
lines.push('');

// More filler to reach ~5000 lines
for (let i = 201; i <= 400; i++) {
  lines.push(`function handler${i}(req, res) { res.end("ok${i}"); }`);
  lines.push(`function validator${i}(data) { return data && data.length > 0; }`);
  lines.push('');
}

lines.push('module.exports = { checkRateLimit };');
lines.push('');

// Write server.js
fs.writeFileSync(path.join(workspaceDir, 'server.js'), lines.join('\n'));

// Create package.json with test script
const pkg = {
  name: "rate-limit-test",
  version: "1.0.0",
  scripts: {
    test: "node test.js"
  }
};
fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify(pkg, null, 2));

// Create test.js
const testContent = `const { checkRateLimit } = require('./server.js');
const assert = require('assert');

function testSlidingWindow() {
  // Clear any state
  const storeModule = require('./server.js');
  
  // Test 1: Basic allowance
  const r1 = checkRateLimit('client1', 3, 1000);
  assert.strictEqual(r1.allowed, true, 'First request should be allowed');
  
  // Test 2: Exceed limit within window
  checkRateLimit('client1', 3, 1000);
  checkRateLimit('client1', 3, 1000);
  const r4 = checkRateLimit('client1', 3, 1000);
  assert.strictEqual(r4.allowed, false, 'Fourth request should be blocked');
  
  // Test 3: After window passes, should allow again (sliding window behavior)
  // Wait for window to slide past the first request
  setTimeout(() => {
    const r5 = checkRateLimit('client1', 3, 1000);
    // With sliding window, old requests should have expired
    assert.strictEqual(r5.allowed, true, 'After window slides, request should be allowed');
    console.log('All tests passed!');
    process.exit(0);
  }, 1100);
}

testSlidingWindow();
`;
fs.writeFileSync(path.join(workspaceDir, 'test.js'), testContent);

console.log('Setup complete - large server.js with buggy rate limiter created');
