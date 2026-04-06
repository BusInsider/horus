// HORUS MEMORY ARCHITECTURE v2.0 - Benchmark Suite
// LoCoMo-style evaluation for local memory accuracy

import { MemoryManagerV2 } from './manager.js';
import { FourChannelFusion } from './retrieval.js';
import { EmbeddingProvider } from '../embedding.js';

// ============================================================================
// BENCHMARK TYPES
// ============================================================================

interface BenchmarkQuery {
  id: string;
  query: string;
  relevantMemoryIds: string[];
  expectedAnswer?: string;
}

interface BenchmarkResult {
  queryId: string;
  topKResults: string[];
  precisionAtK: Record<number, number>;
  recallAtK: Record<number, number>;
  mrr: number; // Mean Reciprocal Rank
  latencyMs: number;
}

interface BenchmarkSuite {
  name: string;
  description: string;
  queries: BenchmarkQuery[];
}

// ============================================================================
// BENCHMARK RUNNER
// ============================================================================

export class MemoryBenchmark {
  private manager: MemoryManagerV2;
  private fusion: FourChannelFusion;
  private embedder: EmbeddingProvider;

  constructor(
    manager: MemoryManagerV2,
    fusion: FourChannelFusion,
    embedder: EmbeddingProvider
  ) {
    this.manager = manager;
    this.fusion = fusion;
    this.embedder = embedder;
  }

  async runBenchmark(suite: BenchmarkSuite, k: number = 10): Promise<{
    results: BenchmarkResult[];
    aggregate: {
      meanPrecisionAtK: Record<number, number>;
      meanRecallAtK: Record<number, number>;
      meanMRR: number;
      meanLatencyMs: number;
      p95LatencyMs: number;
    };
  }> {
    const results: BenchmarkResult[] = [];

    for (const query of suite.queries) {
      const result = await this.evaluateQuery(query, k);
      results.push(result);
    }

    // Calculate aggregates
    const aggregate = this.calculateAggregates(results);

    return { results, aggregate };
  }

  private async evaluateQuery(query: BenchmarkQuery, k: number): Promise<BenchmarkResult> {
    const start = performance.now();

    // Generate embedding
    const embedding = await this.embedder.embed(query.query);

    // Run retrieval
    const context = {
      sessionId: 'benchmark',
      currentEntities: this.extractEntities(query.query),
    };

    const results = this.fusion.retrieve(query.query, embedding, context, { k });

    const latencyMs = performance.now() - start;
    const topKResults = results.map(r => r.id);

    // Calculate metrics
    const relevantSet = new Set(query.relevantMemoryIds);
    const precisionAtK: Record<number, number> = {};
    const recallAtK: Record<number, number> = {};

    for (const kVal of [1, 5, 10]) {
      const topK = topKResults.slice(0, kVal);
      const relevantFound = topK.filter(id => relevantSet.has(id)).length;
      
      precisionAtK[kVal] = relevantFound / kVal;
      recallAtK[kVal] = relevantFound / relevantSet.size;
    }

    // MRR (Mean Reciprocal Rank)
    let mrr = 0;
    for (let i = 0; i < topKResults.length; i++) {
      if (relevantSet.has(topKResults[i])) {
        mrr = 1 / (i + 1);
        break;
      }
    }

    return {
      queryId: query.id,
      topKResults,
      precisionAtK,
      recallAtK,
      mrr,
      latencyMs,
    };
  }

  private calculateAggregates(results: BenchmarkResult[]): {
    meanPrecisionAtK: Record<number, number>;
    meanRecallAtK: Record<number, number>;
    meanMRR: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
  } {
    const kValues = [1, 5, 10];
    const meanPrecisionAtK: Record<number, number> = {};
    const meanRecallAtK: Record<number, number> = {};

    for (const k of kValues) {
      meanPrecisionAtK[k] = results.reduce((sum, r) => sum + r.precisionAtK[k], 0) / results.length;
      meanRecallAtK[k] = results.reduce((sum, r) => sum + r.recallAtK[k], 0) / results.length;
    }

    const meanMRR = results.reduce((sum, r) => sum + r.mrr, 0) / results.length;
    const meanLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

    // P95 latency
    const sortedLatencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p95LatencyMs = sortedLatencies[p95Index];

    return {
      meanPrecisionAtK,
      meanRecallAtK,
      meanMRR,
      meanLatencyMs,
      p95LatencyMs,
    };
  }

  private extractEntities(text: string): string[] {
    const entities: string[] = [];
    const fileMatches = text.match(/[\w/\\.-]+\.(ts|js|json|md|py)/gi);
    if (fileMatches) entities.push(...fileMatches);
    return [...new Set(entities)];
  }
}

// ============================================================================
// BUILT-IN BENCHMARK SUITES
// ============================================================================

export const BENCHMARK_SUITES: Record<string, BenchmarkSuite> = {
  // Basic retrieval accuracy test
  basic: {
    name: 'Basic Retrieval',
    description: 'Simple fact recall with clear queries',
    queries: [
      {
        id: 'basic-1',
        query: 'What is the database schema for users?',
        relevantMemoryIds: ['semantic:1'],
      },
      {
        id: 'basic-2',
        query: 'How do I handle authentication?',
        relevantMemoryIds: ['semantic:2'],
      },
    ],
  },

  // Multi-hop reasoning (requires entity graph)
  multihop: {
    name: 'Multi-hop Reasoning',
    description: 'Queries requiring relationship traversal',
    queries: [
      {
        id: 'multihop-1',
        query: 'What files were changed in the auth refactor?',
        relevantMemoryIds: ['episodic:1', 'episodic:2', 'semantic:3'],
      },
    ],
  },

  // Temporal reasoning
  temporal: {
    name: 'Temporal Reasoning',
    description: 'Recent vs old memory distinction',
    queries: [
      {
        id: 'temporal-1',
        query: 'What did we work on yesterday?',
        relevantMemoryIds: ['episodic:10', 'episodic:11'],
      },
    ],
  },
};

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

export async function runPerformanceTests(
  manager: MemoryManagerV2,
  fusion: FourChannelFusion,
  embedder: EmbeddingProvider
): Promise<{
  retrievalLatency: { mean: number; p95: number; p99: number };
  embeddingLatency: { mean: number; p95: number };
  throughput: { queriesPerSecond: number };
}> {
  const iterations = 100;
  const retrievalLatencies: number[] = [];
  const embeddingLatencies: number[] = [];

  // Test embedding generation
  const testText = 'This is a test query for embedding generation performance';
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await embedder.embed(testText);
    embeddingLatencies.push(performance.now() - start);
  }

  // Test retrieval (requires some data)
  const testQuery = 'test query for retrieval performance';
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const embedding = await embedder.embed(testQuery);
    fusion.retrieve(testQuery, embedding, {}, { k: 10 });
    retrievalLatencies.push(performance.now() - start);
  }

  // Calculate stats
  const sortedRetrieval = retrievalLatencies.sort((a, b) => a - b);
  const sortedEmbedding = embeddingLatencies.sort((a, b) => a - b);

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    retrievalLatency: {
      mean: mean(sortedRetrieval),
      p95: sortedRetrieval[Math.floor(iterations * 0.95)],
      p99: sortedRetrieval[Math.floor(iterations * 0.99)],
    },
    embeddingLatency: {
      mean: mean(sortedEmbedding),
      p95: sortedEmbedding[Math.floor(iterations * 0.95)],
    },
    throughput: {
      queriesPerSecond: 1000 / mean(sortedRetrieval),
    },
  };
}

// ============================================================================
// REPORT GENERATOR
// ============================================================================

export function generateBenchmarkReport(
  benchmarkName: string,
  results: { aggregate: any; results: any[] }
): string {
  const { aggregate } = results;

  return `
========================================
HORUS MEMORY BENCHMARK REPORT
${benchmarkName}
========================================

RETRIEVAL ACCURACY
------------------
Precision@1:  ${(aggregate.meanPrecisionAtK[1] * 100).toFixed(1)}%
Precision@5:  ${(aggregate.meanPrecisionAtK[5] * 100).toFixed(1)}%
Precision@10: ${(aggregate.meanPrecisionAtK[10] * 100).toFixed(1)}%

Recall@1:     ${(aggregate.meanRecallAtK[1] * 100).toFixed(1)}%
Recall@5:     ${(aggregate.meanRecallAtK[5] * 100).toFixed(1)}%
Recall@10:    ${(aggregate.meanRecallAtK[10] * 100).toFixed(1)}%

Mean Reciprocal Rank (MRR): ${aggregate.meanMRR.toFixed(3)}

TARGET: 87.7% accuracy (Mem0 benchmark)
STATUS: ${aggregate.meanPrecisionAtK[5] >= 0.877 ? '✅ PASS' : '❌ NEEDS IMPROVEMENT'}

LATENCY
-------
Mean:  ${aggregate.meanLatencyMs.toFixed(2)}ms
P95:   ${aggregate.p95LatencyMs.toFixed(2)}ms

TARGET: <5ms local retrieval
STATUS: ${aggregate.meanLatencyMs <= 5 ? '✅ PASS' : aggregate.meanLatencyMs <= 20 ? '⚠️ ACCEPTABLE' : '❌ TOO SLOW'}

========================================
`;
}
