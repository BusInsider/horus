#!/usr/bin/env node
/**
 * Verifier for deliberate-plan-flaws
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const correctedPath = path.join(workspaceDir, 'PLAN_CORRECTED.md');
    
    if (!fs.existsSync(correctedPath)) {
      console.log(JSON.stringify({ passed: false, score: 0.0, error: 'PLAN_CORRECTED.md not found' }));
      return;
    }
    
    const content = fs.readFileSync(correctedPath, 'utf-8').toLowerCase();
    
    // Flaws in original plan:
    // 1. No cache invalidation strategy (stale data risk)
    // 2. No race condition handling (cache stampede)
    // 3. No error handling for cache misses
    // 4. TTL of 1 hour without justification
    // 5. No memory limit / eviction policy
    // 6. Tests only verify speed, not correctness
    
    const checks = {
      mentionsInvalidation: content.includes('invalidat') || content.includes('evict') || content.includes('clear') || content.includes('purge'),
      mentionsRaceCondition: content.includes('race') || content.includes('stampede') || content.includes('lock') || content.includes('mutex') || content.includes('semaphore'),
      mentionsErrorHandling: content.includes('error') || content.includes('fallback') || content.includes('graceful'),
      mentionsMemoryLimit: content.includes('memory') || content.includes('size limit') || content.includes('max keys') || content.includes('lru'),
      mentionsCorrectnessTesting: content.includes('correctness') || content.includes('stal') || content.includes('consistency') || content.includes('sync'),
      actuallyCorrected: !fs.readFileSync(correctedPath, 'utf-8').includes('node-cache') || content.includes('redis') || content.includes('memcached')
    };
    
    const score = Object.values(checks).filter(Boolean).length / 6;
    
    console.log(JSON.stringify({
      passed: score >= 0.8,
      score,
      details: checks
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
