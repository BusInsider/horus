#!/usr/bin/env node
/**
 * Setup: Create a file with deeply nested conditionals
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const files = {
  'package.json': JSON.stringify({
    name: 'auth-refactor',
    version: '1.0.0',
    scripts: { test: 'node test/auth.test.js' }
  }, null, 2),

  'src/auth.js': `function checkAccess(user, resource, action) {
  if (user) {
    if (user.active) {
      if (user.roles) {
        if (user.roles.includes('admin')) {
          return { allowed: true, reason: 'admin' };
        } else {
          if (resource) {
            if (resource.public) {
              return { allowed: true, reason: 'public' };
            } else {
              if (resource.owner === user.id) {
                return { allowed: true, reason: 'owner' };
              } else {
                if (action === 'read') {
                  if (user.roles.includes('reader')) {
                    return { allowed: true, reason: 'reader' };
                  } else {
                    return { allowed: false, reason: 'not reader' };
                  }
                } else if (action === 'write') {
                  if (user.roles.includes('writer')) {
                    return { allowed: true, reason: 'writer' };
                  } else {
                    return { allowed: false, reason: 'not writer' };
                  }
                } else {
                  return { allowed: false, reason: 'invalid action' };
                }
              }
            }
          } else {
            return { allowed: false, reason: 'no resource' };
          }
        }
      } else {
        return { allowed: false, reason: 'no roles' };
      }
    } else {
      return { allowed: false, reason: 'inactive' };
    }
  } else {
    if (resource && resource.public) {
      if (action === 'read') {
        return { allowed: true, reason: 'public read' };
      } else {
        return { allowed: false, reason: 'public no read' };
      }
    } else {
      return { allowed: false, reason: 'no user' };
    }
  }
}

module.exports = { checkAccess };
`,

  'test/auth.test.js': `const { checkAccess } = require('../src/auth');

function assertEqual(actual, expected, msg) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(\`\${msg}:\n  expected: \${expectedStr}\n  actual:   \${actualStr}\`);
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(\`FAIL: \${name}\n  \${e.message}\`);
  }
}

// Test cases covering all branches
test('admin user', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: ['admin'] }, { public: false }, 'read'),
    { allowed: true, reason: 'admin' }
  );
});

test('inactive user', () => {
  assertEqual(
    checkAccess({ id: 1, active: false, roles: ['reader'] }, { public: false }, 'read'),
    { allowed: false, reason: 'inactive' }
  );
});

test('public resource', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: ['reader'] }, { public: true }, 'read'),
    { allowed: true, reason: 'public' }
  );
});

test('owner access', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: ['reader'] }, { public: false, owner: 1 }, 'write'),
    { allowed: true, reason: 'owner' }
  );
});

test('reader can read', () => {
  assertEqual(
    checkAccess({ id: 2, active: true, roles: ['reader'] }, { public: false, owner: 1 }, 'read'),
    { allowed: true, reason: 'reader' }
  );
});

test('reader cannot write', () => {
  assertEqual(
    checkAccess({ id: 2, active: true, roles: ['reader'] }, { public: false, owner: 1 }, 'write'),
    { allowed: false, reason: 'not writer' }
  );
});

test('writer can write', () => {
  assertEqual(
    checkAccess({ id: 2, active: true, roles: ['writer'] }, { public: false, owner: 1 }, 'write'),
    { allowed: true, reason: 'writer' }
  );
});

test('no user public read', () => {
  assertEqual(
    checkAccess(null, { public: true }, 'read'),
    { allowed: true, reason: 'public read' }
  );
});

test('no user public write', () => {
  assertEqual(
    checkAccess(null, { public: true }, 'write'),
    { allowed: false, reason: 'public no read' }
  );
});

test('no user private', () => {
  assertEqual(
    checkAccess(null, { public: false }, 'read'),
    { allowed: false, reason: 'no user' }
  );
});

test('invalid action', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: ['admin'] }, { public: false }, 'delete'),
    { allowed: false, reason: 'invalid action' }
  );
});

test('no roles', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: [] }, { public: false }, 'read'),
    { allowed: false, reason: 'no roles' }
  );
});

test('no resource', () => {
  assertEqual(
    checkAccess({ id: 1, active: true, roles: ['reader'] }, null, 'read'),
    { allowed: false, reason: 'no resource' }
  );
});

console.log(\`\nResults: \${passed} passed, \${failed} failed\`);
if (failed > 0) process.exit(1);
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(workspaceDir, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content);
}

console.log('Setup complete: nested-conditional-editing workspace created');
