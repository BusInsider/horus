#!/bin/bash
# Fix native module version mismatches

echo "🔧 Fixing native modules for Node $(node -v)..."
cd "$(dirname "$0")/.."

# Remove old builds
echo "Cleaning old builds..."
rm -rf node_modules/better-sqlite3/build
rm -rf node_modules/@xenova/transformers/node_modules/onnxruntime-node/bin

# Rebuild
echo "Rebuilding better-sqlite3..."
npm rebuild better-sqlite3 --verbose 2>&1 | tail -5

# Reinstall onnxruntime for transformers
echo "Reinstalling onnxruntime-node..."
npm install onnxruntime-node --force 2>&1 | tail -3

echo "✅ Done! Try running 'horus chat' again."
