#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');
fs.mkdirSync(workspaceDir, { recursive: true });

// Create logger.js
fs.writeFileSync(path.join(workspaceDir, 'logger.js'), `function logger(level, msg) { console.log(\`[\${level.toUpperCase()}] \${msg}\`); }
logger.info = (msg) => logger('info', msg);
logger.error = (msg) => logger('error', msg);
module.exports = logger;
`);

// Create 50+ decoy files with similar names and structures
const decoyNames = [
  'auth.js', 'auth-old.js', 'auth-utils.js', 'auth-legacy.js', 'auth-helper.js',
  'billing.js', 'billing-v2.js', 'billing-legacy.js', 'billing-utils.js', 'billing-old.js',
  'cart.js', 'cart-utils.js', 'cart-legacy.js', 'cart-v1.js', 'cart-helper.js',
  'checkout.js', 'checkout-old.js', 'checkout-utils.js', 'checkout-legacy.js', 'checkout-v2.js',
  'inventory.js', 'inventory-utils.js', 'inventory-old.js', 'inventory-legacy.js', 'inventory-v1.js',
  'order.js', 'order-utils.js', 'order-old.js', 'order-legacy.js', 'order-v2.js',
  'payment.js', 'payment-old.js', 'payment-legacy.js', 'payment-utils.js', 'payment-v1.js',
  'product.js', 'product-utils.js', 'product-old.js', 'product-legacy.js', 'product-v2.js',
  'shipping.js', 'shipping-utils.js', 'shipping-old.js', 'shipping-legacy.js', 'shipping-v1.js',
  'user.js', 'user-utils.js', 'user-old.js', 'user-legacy.js', 'user-v2.js',
  'wallet.js', 'wallet-utils.js', 'wallet-old.js', 'wallet-legacy.js', 'wallet-v1.js',
];

for (const name of decoyNames) {
  const content = `// ${name} - decoy module
function process${name.replace('.js', '').replace(/-/g, '')}() { return 'ok'; }
function validate${name.replace('.js', '').replace(/-/g, '')}() { return true; }
function send${name.replace('.js', '').replace(/-/g, '')}() { return 'sent'; }
module.exports = { process${name.replace('.js', '').replace(/-/g, '')}, validate${name.replace('.js', '').replace(/-/g, '')}, send${name.replace('.js', '').replace(/-/g, '')} };
`;
  fs.writeFileSync(path.join(workspaceDir, name), content);
}

// Create the 3 real target files (buried among decoys)
// They have slightly different naming patterns
fs.writeFileSync(path.join(workspaceDir, 'card-validation.js'), `// Card validation module
function validateCard(number, expiry, cvv) {
  if (!number || number.length < 13) return false;
  if (!expiry || !/^\\d{2}\\/\\d{2}$/.test(expiry)) return false;
  if (!cvv || cvv.length < 3) return false;
  return true;
}
module.exports = { validateCard };
`);

fs.writeFileSync(path.join(workspaceDir, 'charge-processor.js'), `// Charge processor
function processCharge(amount, currency, source) {
  if (amount <= 0) throw new Error('Invalid amount');
  if (!['USD', 'EUR', 'GBP'].includes(currency)) throw new Error('Unsupported currency');
  return { id: 'ch_' + Math.random().toString(36).slice(2), amount, currency, status: 'succeeded' };
}
module.exports = { processCharge };
`);

fs.writeFileSync(path.join(workspaceDir, 'receipt-sender.js'), `// Receipt sender
function sendReceipt(chargeId, email, items) {
  if (!email || !email.includes('@')) throw new Error('Invalid email');
  return { chargeId, email, sent: true };
}
module.exports = { sendReceipt };
`);

// Create test
const testContent = `const cardValidation = require('./card-validation.js');
const chargeProcessor = require('./charge-processor.js');
const receiptSender = require('./receipt-sender.js');
const fs = require('fs');
const assert = require('assert');

// Check that logger.info was added to each function
const cardSrc = fs.readFileSync('./card-validation.js', 'utf-8');
const chargeSrc = fs.readFileSync('./charge-processor.js', 'utf-8');
const receiptSrc = fs.readFileSync('./receipt-sender.js', 'utf-8');

assert(cardSrc.includes('logger.info') || cardSrc.includes("logger.info"), 'validateCard needs logger.info');
assert(chargeSrc.includes('logger.info') || chargeSrc.includes("logger.info"), 'processCharge needs logger.info');
assert(receiptSrc.includes('logger.info') || receiptSrc.includes("logger.info"), 'sendReceipt needs logger.info');

// Functions still work
assert.strictEqual(cardValidation.validateCard('4111111111111111', '12/25', '123'), true);
assert.strictEqual(chargeProcessor.processCharge(100, 'USD', 'tok_visa').status, 'succeeded');
assert.strictEqual(receiptSender.sendReceipt('ch_123', 'test@example.com', []).sent, true);

console.log('All tests passed!');
`;
fs.writeFileSync(path.join(workspaceDir, 'test.js'), testContent);

const pkg = { name: "context-pressure-test", version: "1.0.0", scripts: { test: "node test.js" } };
fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('Setup complete - 50+ decoy files + 3 target files created');
