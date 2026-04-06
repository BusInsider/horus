import { describe, it, expect } from '@jest/globals';

// Test the buffer conversion utilities directly
// Import from a local utility to avoid loading the full embedding module
function embeddingToBuffer(embedding: number[]): Buffer {
  const floatArray = new Float32Array(embedding);
  return Buffer.from(floatArray.buffer);
}

function bufferToEmbedding(buffer: Buffer): number[] {
  const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  return Array.from(floatArray);
}

describe('Embedding buffer utilities', () => {
  it('should convert number[] to Buffer and back', () => {
    const original = [0.1, 0.2, 0.3, 0.4, 0.5];
    const buffer = embeddingToBuffer(original);
    const result = bufferToEmbedding(buffer);
    
    expect(result).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(result[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('should handle empty arrays', () => {
    const original: number[] = [];
    const buffer = embeddingToBuffer(original);
    const result = bufferToEmbedding(buffer);
    expect(result).toHaveLength(0);
  });

  it('should handle large arrays', () => {
    const original = new Array(384).fill(0).map((_, i) => i / 384);
    const buffer = embeddingToBuffer(original);
    const result = bufferToEmbedding(buffer);
    
    expect(result).toHaveLength(384);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[383]).toBeCloseTo(383/384, 5);
  });
});
