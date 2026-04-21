#!/usr/bin/env node
/**
 * Check native modules and auto-rebuild if needed
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HORUS_DIR = path.join(__dirname, '..');
const BSQLITE3_PATH = path.join(HORUS_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

function getNodeModuleVersion() {
  return process.versions.modules;
}

function checkNativeModule() {
  // Check if better-sqlite3 exists
  if (!fs.existsSync(BSQLITE3_PATH)) {
    console.error('❌ better-sqlite3 not found');
    return false;
  }

  try {
    // Try to require it - this will fail with version mismatch
    require('better-sqlite3');
    return true;
  } catch (err) {
    if (err.message.includes('NODE_MODULE_VERSION')) {
      console.error('❌ Native module version mismatch detected');
      return false;
    }
    throw err;
  }
}

function rebuild() {
  console.log('🔧 Rebuilding native modules...');
  try {
    execSync('npm rebuild better-sqlite3', {
      cwd: HORUS_DIR,
      stdio: 'inherit',
      timeout: 120000,
    });
    console.log('✅ Rebuild complete');
    return true;
  } catch (err) {
    console.error('❌ Rebuild failed:', err.message);
    return false;
  }
}

function main() {
  const currentVersion = getNodeModuleVersion();
  
  if (!checkNativeModule()) {
    console.log(`Node ABI version: ${currentVersion}`);
    console.log('Attempting automatic rebuild...\n');
    
    if (rebuild()) {
      // Verify it worked
      if (checkNativeModule()) {
        console.log('✅ Native modules ready');
        process.exit(0);
      } else {
        console.error('❌ Rebuild did not fix the issue');
        console.error('\nTry manually:');
        console.error('  cd ~/.hermes/workspace/horus');
        console.error('  rm -rf node_modules/better-sqlite3/build');
        console.error('  npm install better-sqlite3');
        process.exit(1);
      }
    } else {
      process.exit(1);
    }
  }
  
  // All good
  process.exit(0);
}

main();
