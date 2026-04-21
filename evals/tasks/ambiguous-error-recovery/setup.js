#!/usr/bin/env node
/**
 * Setup: Create a project where the test failure symptom is misleading
 * The error appears in api.js but the root cause is in config.js (wrong default port string vs number)
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const files = {
  'package.json': JSON.stringify({
    name: 'api-server',
    version: '1.0.0',
    scripts: { test: 'node test/api.test.js' }
  }, null, 2),

  'src/config.js': `function loadConfig() {
  return {
    // BUG: port should be a number, not a string
    port: process.env.PORT || '3000',
    host: 'localhost',
    timeout: 5000
  };
}

module.exports = { loadConfig };
`,

  'src/api.js': `const http = require('http');
const { loadConfig } = require('./config');
const { router } = require('./router');

function startServer() {
  const config = loadConfig();
  
  // This line throws: TypeError [ERR_INVALID_ARG_TYPE]: The "options.port" property must be number.
  // But the error stack points here, making it look like api.js is the problem.
  const server = http.createServer((req, res) => {
    router.handle(req, res);
  });
  
  server.listen(config.port, config.host, () => {
    console.log(\`Server running on \${config.host}:\${config.port}\`);
  });
  
  return server;
}

module.exports = { startServer };
`,

  'src/router.js': `const routes = new Map();

function register(path, handler) {
  routes.set(path, handler);
}

register('/health', (req, res) => {
  res.writeHead(200);
  res.end('OK');
});

register('/data', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ items: [] }));
});

const router = {
  handle: (req, res) => {
    const handler = routes.get(req.url);
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
};

module.exports = { router, register };
`,

  'src/middleware.js': `function loggingMiddleware(req, res, next) {
  console.log(\`\${req.method} \${req.url}\`);
  next();
}

function errorMiddleware(err, req, res, next) {
  console.error(err);
  res.writeHead(500);
  res.end('Internal Server Error');
}

module.exports = { loggingMiddleware, errorMiddleware };
`,

  'test/api.test.js': `const { startServer } = require('../src/api');
const http = require('http');

async function testServer() {
  let server;
  try {
    server = startServer();
    
    // Give server a moment to start
    await new Promise(r => setTimeout(r, 100));
    
    const res = await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:3000/health', resolve);
      req.on('error', reject);
    });
    
    let data = '';
    res.on('data', chunk => data += chunk);
    await new Promise(r => res.on('end', r));
    
    if (data === 'OK') {
      console.log('PASS: Server responds correctly');
      server.close();
      process.exit(0);
    } else {
      console.error(\`FAIL: Unexpected response: \${data}\`);
      server.close();
      process.exit(1);
    }
  } catch (e) {
    console.error(\`FAIL: \${e.message}\`);
    if (server && server.close) server.close();
    process.exit(1);
  }
}

testServer();
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(workspaceDir, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content);
}

console.log('Setup complete: ambiguous-error-recovery workspace created');
