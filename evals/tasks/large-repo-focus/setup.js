#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

const monorepoDir = path.join(workspaceDir, 'monorepo');
fs.mkdirSync(monorepoDir, { recursive: true });

const packages = ['core', 'utils', 'ui', 'api', 'db', 'auth', 'billing', 'analytics'];
const subdirs = ['src', 'lib', 'helpers', 'models', 'services', 'components', 'hooks', 'utils'];

let fileCount = 0;

// Generate 1200+ files
for (let pkgIdx = 0; pkgIdx < packages.length; pkgIdx++) {
  const pkg = packages[pkgIdx];
  for (let subIdx = 0; subIdx < subdirs.length; subIdx++) {
    const sub = subdirs[subIdx];
    const dir = path.join(monorepoDir, `packages/${pkg}/${sub}`);
    fs.mkdirSync(dir, { recursive: true });
    
    // 15-20 files per directory
    const filesInDir = 15 + Math.floor(Math.random() * 6);
    for (let f = 0; f < filesInDir; f++) {
      const name = `${pkg}_${sub}_${f}.ts`;
      const content = `export function ${pkg}${sub}${f}(x: number): number { return x + ${f}; }\n`;
      fs.writeFileSync(path.join(dir, name), content);
      fileCount++;
    }
  }
}

// Add some root-level files
for (let i = 0; i < 100; i++) {
  fs.writeFileSync(
    path.join(monorepoDir, `root_${i}.ts`),
    `export const value${i} = ${i};\n`
  );
  fileCount++;
}

// The target file — hidden deep in the tree
const targetDir = path.join(monorepoDir, 'packages/billing/services');
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(
  path.join(targetDir, 'shipping.ts'),
  `export function calculateShippingCost(weight: number): number {\n  return weight * 2.5;\n}\n`
);
fileCount++;

console.log(`Setup complete - ${fileCount} files created`);
