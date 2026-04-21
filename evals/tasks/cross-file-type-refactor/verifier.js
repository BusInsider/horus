#!/usr/bin/env node
/**
 * Verifier for cross-file-type-refactor
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    const files = [
      'src/models/user.ts',
      'src/services/user-service.ts',
      'src/api/routes.ts',
      'src/db/repository.ts',
      'test/user.test.ts'
    ];
    
    const checks = {};
    
    for (const f of files) {
      const p = path.join(workspaceDir, f);
      if (!fs.existsSync(p)) {
        checks[f] = false;
        continue;
      }
      const content = fs.readFileSync(p, 'utf-8');
      // Must NOT have 'id: number' anywhere
      const hasNumberId = /id\s*:\s*number/.test(content);
      if (hasNumberId) {
        checks[f] = false;
        continue;
      }
      // For model files: must explicitly have id: string
      if (f.includes('models')) {
        checks[f] = /id\s*:\s*string/.test(content);
        continue;
      }
      // For other files: acceptable if no number type and uses string-typed IDs
      // (e.g. path.split('/')[2], typeof === 'string', etc.)
      checks[f] = true;
    }
    
    // Check no raw parseInt for IDs in routes (should use string IDs)
    const routesPath = path.join(workspaceDir, 'src', 'api', 'routes.ts');
    if (fs.existsSync(routesPath)) {
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      checks['routes_no_parseint'] = !routesContent.includes('parseInt');
    }
    
    // Check repository uses string keys
    const repoPath = path.join(workspaceDir, 'src', 'db', 'repository.ts');
    if (fs.existsSync(repoPath)) {
      const repoContent = fs.readFileSync(repoPath, 'utf-8');
      checks['repo_string_map'] = repoContent.includes('Map<string') || !repoContent.includes('Map<number');
    }
    
    // Try TypeScript compile (skipLibCheck to avoid parent node_modules conflicts)
    let tsCompileOk = false;
    try {
      execSync('npx tsc --noEmit --skipLibCheck', { cwd: workspaceDir, encoding: 'utf-8', timeout: 30000 });
      tsCompileOk = true;
    } catch {
      tsCompileOk = false;
    }
    checks['ts_compile'] = tsCompileOk;
    
    const values = Object.values(checks);
    const score = values.filter(Boolean).length / values.length;
    
    console.log(JSON.stringify({
      passed: score >= 0.85,
      score,
      details: checks
    }));
    
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
