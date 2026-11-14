/**
 * Deterministic embeddings for the OpenRouter-compatible route.
 */

/** The encoder used to hash each word as UTF-8 bytes. */
const UTF8_ENCODER = new TextEncoder()

/** The offset basis of the 32-bit FNV-1a hash. */
const FNV_OFFSET_BASIS = 0x811c9dc5

/** The prime of the 32-bit FNV-1a hash. */
const FNV_PRIME = 0x01000193

/** A text embedding and the number of words that produced it. */
export interface TextEmbedding {
  embedding: number[]
  wordCount: number
}

/**
 * The deterministic embedding of a text.
 * @param text The text to embed.
 * @param dimensions The number of dimensions in the vector.
 */
export function embedText(text: string, dimensions: number): TextEmbedding {
  const words = embeddingWords(text)
  const vector = new Array<number>(dimensions).fill(0)

  for (const word of words) {
    const dimension = fnv1a(word) % dimensions
    vector[dimension] = (vector[dimension] ?? 0) + 1
  }

  return { embedding: normalize(vector), wordCount: words.length }
}

/**
 * The words used by an embedding, after removing the role prefix.
 * @param text The text to split.
 */
export function embeddingWords(text: string): string[] {
  const withoutPrefix = text.trim().replace(/^(?:query|passage):\s*/i, '').toLowerCase().trim()
  return withoutPrefix === '' ? [] : withoutPrefix.split(/\s+/)
}

/**
 * The 32-bit FNV-1a hash of a word's UTF-8 bytes.
 * @param word The word to hash.
 */
function fnv1a(word: string): number {
  let hash = FNV_OFFSET_BASIS
  for (const byte of UTF8_ENCODER.encode(word)) {
    hash ^= byte
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * The unit-length version of a vector.
 * @param vector The vector to normalize.
 */
function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) {
    const unit = new Array<number>(vector.length).fill(0)
    unit[0] = 1
    return unit
  }
  return vector.map((value) => value / magnitude)
}
