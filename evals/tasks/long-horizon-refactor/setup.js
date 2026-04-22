#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create a monolithic utils.js with ~600 lines
const validators = `
function isEmail(str) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str); }
function isURL(str) { try { new URL(str); return true; } catch { return false; } }
function isUUID(str) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str); }
function isHex(str) { return /^[0-9a-f]+$/i.test(str); }
function isJSON(str) { try { JSON.parse(str); return true; } catch { return false; } }
function isBase64(str) { return /^[A-Za-z0-9+/]*={0,2}$/.test(str); }
function isPort(num) { return Number.isInteger(num) && num >= 1 && num <= 65535; }
function isIP(str) { return /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(str); }
`;

const formatters = `
function formatDate(d, fmt = 'iso') { const date = new Date(d); if (fmt === 'iso') return date.toISOString(); if (fmt === 'local') return date.toLocaleString(); return date.toString(); }
function formatCurrency(n, currency = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n); }
function formatBytes(b) { const sizes = ['B','KB','MB','GB']; if (b === 0) return '0 B'; const i = Math.floor(Math.log2(b) / 10); return (b / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i]; }
function formatDuration(ms) { if (ms < 1000) return ms + 'ms'; if (ms < 60000) return (ms/1000).toFixed(1) + 's'; return (ms/60000).toFixed(1) + 'm'; }
function formatPhone(str) { const digits = str.replace(/\\D/g, ''); if (digits.length === 10) return digits.replace(/(\\d{3})(\\d{3})(\\d{4})/, '($1) $2-$3'); return str; }
function formatList(arr) { if (arr.length === 0) return ''; if (arr.length === 1) return arr[0]; return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]; }
function formatPercent(n, decimals = 1) { return (n * 100).toFixed(decimals) + '%'; }
function formatSlug(str) { return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
`;

const cryptoutils = `
const crypto = require('crypto');
function hash(str, algo = 'sha256') { return crypto.createHash(algo).update(str).digest('hex'); }
function verify(input, expected, algo = 'sha256') { return hash(input, algo) === expected; }
function generateToken(len = 32) { return crypto.randomBytes(len).toString('hex'); }
function hmac(data, secret, algo = 'sha256') { return crypto.createHmac(algo, secret).update(data).digest('hex'); }
function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }
function sha1(str) { return crypto.createHash('sha1').update(str).digest('hex'); }
function sha512(str) { return crypto.createHash('sha512').update(str).digest('hex'); }
function pbkdf2(password, salt, iterations = 100000, keylen = 64) { return crypto.pbkdf2Sync(password, salt, iterations, keylen, 'sha256').toString('hex'); }
`;

const http = `
function buildQuery(obj) { return Object.entries(obj).map(([k,v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
function parseCookie(str) { return Object.fromEntries(str.split(';').map(c => c.trim().split('=')).map(([k,...v]) => [k, v.join('=')])); }
function sanitizeHeader(str) { return str.replace(/[^a-zA-Z0-9-_]/g, ''); }
function parseAcceptHeader(str) { return str.split(',').map(s => { const [type, ...rest] = s.trim().split(';'); return { type: type.trim(), q: rest.find(r => r.trim().startsWith('q='))?.split('=')[1] || '1' }; }).sort((a,b) => b.q - a.q); }
function isSafeMethod(method) { return ['GET','HEAD','OPTIONS','TRACE'].includes(method.toUpperCase()); }
function isRedirect(status) { return status >= 300 && status < 400; }
function isErrorStatus(status) { return status >= 400; }
function isSuccessStatus(status) { return status >= 200 && status < 300; }
`;

const content = `// Monolithic utility module - DO NOT KEEP THIS WAY
${validators}
${formatters}
${cryptoutils}
${http}

module.exports = {
  isEmail, isURL, isUUID, isHex, isJSON, isBase64, isPort, isIP,
  formatDate, formatCurrency, formatBytes, formatDuration, formatPhone, formatList, formatPercent, formatSlug,
  hash, verify, generateToken, hmac, md5, sha1, sha512, pbkdf2,
  buildQuery, parseCookie, sanitizeHeader, parseAcceptHeader, isSafeMethod, isRedirect, isErrorStatus, isSuccessStatus
};
`;

fs.writeFileSync(path.join(workspaceDir, 'utils.js'), content);

// Create tests
const testContent = `const utils = require('./utils.js');
const assert = require('assert');

assert.strictEqual(utils.isEmail('test@example.com'), true);
assert.strictEqual(utils.isURL('https://example.com'), true);
assert.strictEqual(utils.isUUID('550e8400-e29b-41d4-a716-446655440000'), true);
assert.strictEqual(utils.formatBytes(1024), '1.00 KB');
assert.strictEqual(utils.formatDuration(1500), '1.5s');
assert.strictEqual(utils.hash('hello').length, 64);
assert.strictEqual(utils.verify('hello', utils.hash('hello')), true);
assert.strictEqual(utils.generateToken().length, 64);
assert.strictEqual(utils.buildQuery({a:1,b:2}), 'a=1&b=2');
assert.strictEqual(utils.isSafeMethod('GET'), true);
assert.strictEqual(utils.isErrorStatus(404), true);
assert.strictEqual(utils.formatPercent(0.123), '12.3%');
assert.strictEqual(utils.formatSlug('Hello World!'), 'hello-world');

console.log('All tests passed!');
`;
fs.writeFileSync(path.join(workspaceDir, 'test.js'), testContent);

const pkg = { name: "refactor-test", version: "1.0.0", scripts: { test: "node test.js" } };
fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('Setup complete - monolithic utils.js created');
