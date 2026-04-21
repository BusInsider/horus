#!/usr/bin/env node
/**
 * Setup: Create a multi-file project with a subtle off-by-one bug
 */

const fs = require('fs');
const path = require('path');

const workspaceDir = process.argv[2] || path.join(__dirname, 'workspace');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Create a realistic-looking project with many files
const files = {
  'package.json': JSON.stringify({
    name: 'batch-processor',
    version: '1.0.0',
    description: 'Processes data in batches',
    main: 'src/index.js',
    scripts: { test: 'node test/runner.js' }
  }, null, 2),

  'src/index.js': `const { BatchProcessor } = require('./processor');
const { Logger } = require('./utils/logger');
const { ConfigLoader } = require('./config/loader');

async function main() {
  const config = await ConfigLoader.load();
  const logger = new Logger(config.logLevel);
  const processor = new BatchProcessor(config.batchSize, logger);
  
  const data = await processor.loadData(config.inputPath);
  const results = await processor.processAll(data);
  
  logger.info(\`Processed \${results.length} items\`);
  await processor.saveResults(results, config.outputPath);
}

main().catch(console.error);
`,

  'src/processor.js': `const { WorkerPool } = require('./workers/pool');
const { Validator } = require('./utils/validator');
const { MetricsCollector } = require('./metrics/collector');

class BatchProcessor {
  constructor(batchSize = 100, logger = console) {
    this.batchSize = batchSize;
    this.logger = logger;
    this.metrics = new MetricsCollector();
    this.validator = new Validator();
  }

  async loadData(inputPath) {
    // Simulated data loading
    const data = [];
    for (let i = 0; i < 1000; i++) {
      data.push({ id: i, value: Math.random() * 100 });
    }
    return data;
  }

  async processAll(items) {
    const pool = new WorkerPool(4);
    const results = [];
    
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      // BUG: Off-by-one when i + batchSize >= items.length
      // The last batch may have fewer items but processBatch expects full size
      const processed = await this.processBatch(batch, i / this.batchSize);
      results.push(...processed);
      this.metrics.recordBatch(batch.length);
    }
    
    await pool.terminate();
    return results;
  }

  async processBatch(batch, batchIndex) {
    // BUG IS HERE: assumes batch.length === this.batchSize
    // When last batch is smaller, this causes index out of bounds on shared buffer
    const results = new Array(this.batchSize);
    
    await Promise.all(batch.map(async (item, idx) => {
      const valid = this.validator.check(item);
      if (valid) {
        results[idx] = { ...item, processed: true, batchIndex };
      } else {
        results[idx] = { ...item, processed: false, error: 'validation failed' };
      }
    }));
    
    return results;
  }

  async saveResults(results, outputPath) {
    this.logger.info(\`Saving \${results.length} results\`);
    // Simulated save
  }
}

module.exports = { BatchProcessor };
`,

  'src/workers/pool.js': `class WorkerPool {
  constructor(size) {
    this.size = size;
    this.workers = [];
  }

  async execute(task) {
    return task();
  }

  async terminate() {
    this.workers = [];
  }
}

module.exports = { WorkerPool };
`,

  'src/workers/task.js': `class WorkerTask {
  constructor(fn, priority = 0) {
    this.fn = fn;
    this.priority = priority;
    this.createdAt = Date.now();
  }

  async run() {
    return this.fn();
  }
}

module.exports = { WorkerTask };
`,

  'src/utils/logger.js': `class Logger {
  constructor(level = 'info') {
    this.level = level;
  }

  info(msg) { if (this.level !== 'silent') console.log(\`[INFO] \${msg}\`); }
  warn(msg) { if (this.level !== 'silent') console.log(\`[WARN] \${msg}\`); }
  error(msg) { if (this.level !== 'silent') console.error(\`[ERROR] \${msg}\`); }
}

module.exports = { Logger };
`,

  'src/utils/validator.js': `class Validator {
  check(item) {
    return item && typeof item.id === 'number' && typeof item.value === 'number';
  }

  checkBatch(batch) {
    return batch.every(item => this.check(item));
  }
}

module.exports = { Validator };
`,

  'src/utils/helpers.js': `function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

module.exports = { debounce, throttle };
`,

  'src/config/loader.js': `const fs = require('fs');
const path = require('path');

class ConfigLoader {
  static async load(configPath = 'config.json') {
    const defaults = {
      batchSize: 100,
      logLevel: 'info',
      inputPath: 'data/input.json',
      outputPath: 'data/output.json',
      maxRetries: 3
    };
    
    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      const user = JSON.parse(content);
      return { ...defaults, ...user };
    } catch {
      return defaults;
    }
  }
}

module.exports = { ConfigLoader };
`,

  'src/config/schema.js': `const schema = {
  batchSize: { type: 'number', min: 1, max: 10000 },
  logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error', 'silent'] },
  inputPath: { type: 'string' },
  outputPath: { type: 'string' },
  maxRetries: { type: 'number', min: 0, max: 10 }
};

module.exports = { schema };
`,

  'src/metrics/collector.js': `class MetricsCollector {
  constructor() {
    this.batches = [];
    this.startTime = Date.now();
  }

  recordBatch(size) {
    this.batches.push({ size, timestamp: Date.now() });
  }

  getStats() {
    const total = this.batches.reduce((sum, b) => sum + b.size, 0);
    const avg = total / this.batches.length || 0;
    return { totalBatches: this.batches.length, totalItems: total, avgBatchSize: avg };
  }
}

module.exports = { MetricsCollector };
`,

  'src/metrics/reporter.js': `class MetricsReporter {
  constructor(collector) {
    this.collector = collector;
  }

  report() {
    const stats = this.collector.getStats();
    return JSON.stringify(stats, null, 2);
  }
}

module.exports = { MetricsReporter };
`,

  'test/runner.js': `const { BatchProcessor } = require('../src/processor');

async function runTests() {
  const processor = new BatchProcessor(100);
  const data = await processor.loadData();
  const results = await processor.processAll(data);
  
  // Check we got exactly 1000 results
  if (results.length !== 1000) {
    console.error(\`FAIL: Expected 1000 results, got \${results.length}\`);
    console.error('Some results may be undefined due to batch boundary bug');
    process.exit(1);
  }
  
  // Check no undefined entries
  const undefinedCount = results.filter(r => r === undefined).length;
  if (undefinedCount > 0) {
    console.error(\`FAIL: Found \${undefinedCount} undefined results\`);
    process.exit(1);
  }
  
  console.log('PASS: All 1000 items processed correctly');
}

runTests().catch(console.error);
`,

  'README.md': `# Batch Processor

Processes data in configurable batch sizes using a worker pool.

## Usage

\`\`\`bash
node src/index.js
\`\`\`

## Configuration

Create a \`config.json\` file to override defaults.

## Testing

\`\`\`bash
npm test
\`\`\`
`,

  'docs/architecture.md': `# Architecture

The batch processor uses a worker pool to parallelize processing.
Data is loaded, split into batches, and processed concurrently.
Results are aggregated and saved.

## Key Components

- BatchProcessor: Orchestrates loading, processing, saving
- WorkerPool: Manages concurrent workers
- Validator: Validates data items
- MetricsCollector: Tracks performance metrics
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(workspaceDir, filePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content);
}

console.log('Setup complete: large-context-bug-hunt workspace created');
