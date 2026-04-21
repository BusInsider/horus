#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2] || path.join(__dirname, 'output');
const workspaceDir = path.join(outputDir, 'workspace');

function main() {
  try {
    // Check for required files
    const checks = {
      modelsTodo: fs.existsSync(path.join(workspaceDir, 'models', 'Todo.js')),
      routesTodos: fs.existsSync(path.join(workspaceDir, 'routes', 'todos.js')),
      appJs: fs.existsSync(path.join(workspaceDir, 'app.js')),
      packageJson: fs.existsSync(path.join(workspaceDir, 'package.json')),
    };
    
    let score = 0;
    const fileCount = Object.values(checks).filter(Boolean).length;
    score = fileCount / 4;
    
    // Bonus for content quality
    if (checks.appJs) {
      const appContent = fs.readFileSync(path.join(workspaceDir, 'app.js'), 'utf-8');
      if (appContent.includes('express') && (appContent.includes('listen') || appContent.includes('app'))) {
        score += 0.1;
      }
    }
    
    if (checks.routesTodos) {
      const routesContent = fs.readFileSync(path.join(workspaceDir, 'routes', 'todos.js'), 'utf-8');
      const hasRoutes = ['get', 'post', 'put', 'delete'].every(method => 
        routesContent.toLowerCase().includes(method)
      );
      if (hasRoutes) score += 0.1;
    }
    
    if (checks.modelsTodo) {
      const modelContent = fs.readFileSync(path.join(workspaceDir, 'models', 'Todo.js'), 'utf-8');
      if (modelContent.includes('title') && modelContent.includes('completed')) {
        score += 0.1;
      }
    }
    
    score = Math.min(score, 1.0);
    const passed = score >= 0.7;
    
    console.log(JSON.stringify({
      passed,
      score,
      details: checks
    }));
  } catch (e) {
    console.log(JSON.stringify({ passed: false, score: 0.0, error: e.message }));
  }
}

main();
