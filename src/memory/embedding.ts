import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

export interface EmbeddingProvider {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  similarity(a: number[], b: number[]): number;
  findTopK(query: number[], candidates: Array<{ id: string; embedding: number[]; metadata?: any }>, k: number): Array<{ id: string; score: number; metadata?: any }>;
}

export class LocalEmbeddingModel implements EmbeddingProvider {
  private pipeline: FeatureExtractionPipeline | null = null;
  private modelName: string;
  private ready: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Configure transformers to use local cache
      const { env } = await import('@xenova/transformers');
      env.localModelPath = '~/.horus/models';
      env.allowRemoteModels = true;
      env.cacheDir = '~/.horus/cache';

      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        revision: 'main',
        quantized: true, // Use quantized model for faster inference
      });

      this.ready = true;
    } catch (error) {
      console.error('Failed to initialize embedding model:', error);
      throw error;
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.initialize();
    if (!this.pipeline) {
      throw new Error('Embedding model not initialized');
    }

    // Truncate long texts (model limit is typically 512 tokens)
    const truncated = this.truncateText(text, 1000);

    const result = await this.pipeline(truncated, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();
    if (!this.pipeline) {
      throw new Error('Embedding model not initialized');
    }

    const truncated = texts.map(t => this.truncateText(t, 1000));

    const results = await this.pipeline(truncated, {
      pooling: 'mean',
      normalize: true,
    });

    // Results might be batched, handle both single and array returns
    if (Array.isArray(results)) {
      return results.map(r => Array.from(r.data as Float32Array));
    }

    return [Array.from(results.data as Float32Array)];
  }

  similarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Find top-k most similar embeddings
  findTopK(
    query: number[],
    candidates: Array<{ id: string; embedding: number[]; metadata?: any }>,
    k: number
  ): Array<{ id: string; score: number; metadata?: any }> {
    const scored = candidates.map(c => ({
      id: c.id,
      score: this.similarity(query, c.embedding),
      metadata: c.metadata,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars);
  }

  isReady(): boolean {
    return this.ready;
  }
}

// Buffer conversion utilities for SQLite storage
export function embeddingToBuffer(embedding: number[]): Buffer {
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
}

export function bufferToEmbedding(buffer: Buffer): number[] {
  // Create a copy of the buffer data to ensure correct alignment
  // SQLite may return a Buffer that shares an underlying ArrayBuffer
  const bufferCopy = Buffer.from(buffer);
  const floatArray = new Float32Array(bufferCopy.buffer, bufferCopy.byteOffset, bufferCopy.length / 4);
  return Array.from(floatArray);
}
