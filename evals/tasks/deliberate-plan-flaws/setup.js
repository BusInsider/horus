#!/usr/bin/env node
/**
 * Setup: Create a PLAN.md with subtle logical flaws
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const draftPlanContent = `# Plan: Add In-Memory Caching Layer

## Objective
Improve API response times by adding an in-memory cache for frequently accessed data.

## Steps

1. **Install cache dependency**
   - Run: npm install node-cache

2. **Create cache module**
   - File: src/cache.js
   - Export a singleton cache instance with TTL of 1 hour

3. **Wrap database calls**
   - In src/db.js, before every query, check cache first
   - If cache hit, return cached data
   - If cache miss, query DB, store result, return it

4. **Integrate into API routes**
   - In src/api.js, use cache for GET /users and GET /users/:id
   - Skip cache for POST, PUT, DELETE

5. **Testing**
   - Write tests verifying cache returns data faster than DB

## Rollback Strategy
Delete src/cache.js and revert src/db.js and src/api.js.

## Estimated Time
2 hours
`;

const files = {
  'DRAFT_PLAN.md': draftPlanContent,
  'package.json': JSON.stringify({ name: 'cache-plan-review', version: '1.0.0' }, null, 2)
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(workspaceDir, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content);
}

console.log('Setup complete: deliberate-plan-flaws workspace created');
