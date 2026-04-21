#!/usr/bin/env node
/**
 * Setup: Multi-file TS project where User.id needs to change from number to string
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const files = {
  'package.json': JSON.stringify({
    name: 'user-service',
    version: '1.0.0',
    scripts: { build: 'tsc --noEmit', test: 'node test/user.test.js' }
  }, null, 2),

  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      strict: true,
      noEmit: true,
      esModuleInterop: true
    },
    include: ['src/**/*', 'test/**/*']
  }, null, 2),

  'src/models/user.ts': `export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export interface UserInput {
  name: string;
  email: string;
}
`,

  'src/services/user-service.ts': `import { User, UserInput } from '../models/user';

let nextId = 1;
const users: User[] = [];

export function createUser(input: UserInput): User {
  const user: User = {
    id: nextId++,
    name: input.name,
    email: input.email,
    createdAt: new Date()
  };
  users.push(user);
  return user;
}

export function getUserById(id: number): User | undefined {
  return users.find(u => u.id === id);
}

export function updateUser(id: number, updates: Partial<UserInput>): User | null {
  const user = getUserById(id);
  if (!user) return null;
  Object.assign(user, updates);
  return user;
}

export function deleteUser(id: number): boolean {
  const index = users.findIndex(u => u.id === id);
  if (index === -1) return false;
  users.splice(index, 1);
  return true;
}
`,

  'src/api/routes.ts': `import { User, UserInput } from '../models/user';
import { createUser, getUserById, updateUser, deleteUser } from '../services/user-service';

export function handleRequest(method: string, path: string, body?: any) {
  if (path === '/users' && method === 'POST') {
    const user = createUser(body as UserInput);
    return { status: 201, data: user };
  }
  
  if (path.startsWith('/users/') && method === 'GET') {
    const id = parseInt(path.split('/')[2], 10);
    const user = getUserById(id);
    return user ? { status: 200, data: user } : { status: 404 };
  }
  
  if (path.startsWith('/users/') && method === 'PUT') {
    const id = parseInt(path.split('/')[2], 10);
    const user = updateUser(id, body);
    return user ? { status: 200, data: user } : { status: 404 };
  }
  
  if (path.startsWith('/users/') && method === 'DELETE') {
    const id = parseInt(path.split('/')[2], 10);
    const success = deleteUser(id);
    return { status: success ? 204 : 404 };
  }
  
  return { status: 404 };
}
`,

  'src/db/repository.ts': `import { User } from '../models/user';

const db = new Map<number, User>();

export function saveUser(user: User): void {
  db.set(user.id, user);
}

export function findById(id: number): User | undefined {
  return db.get(id);
}

export function findAll(): User[] {
  return Array.from(db.values());
}
`,

  'test/user.test.ts': `import { createUser, getUserById, updateUser, deleteUser } from '../src/services/user-service';
import { saveUser, findById } from '../src/db/repository';

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    throw new Error(\`\${msg}: expected \${expected}, got \${actual}\`);
  }
}

const user = createUser({ name: 'Alice', email: 'alice@example.com' });
assertEqual(typeof user.id, 'number', 'id should be number');

saveUser(user);
const found = findById(user.id);
if (!found) throw new Error('User not found in repo');
assertEqual(found.name, 'Alice', 'name should match');

const updated = updateUser(user.id, { name: 'Bob' });
if (!updated) throw new Error('Update failed');
assertEqual(updated.name, 'Bob', 'name should be updated');

const deleted = deleteUser(user.id);
assertEqual(deleted, true, 'delete should succeed');

console.log('PASS: All user operations work');
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(workspaceDir, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content);
}

console.log('Setup complete: cross-file-type-refactor workspace created');
