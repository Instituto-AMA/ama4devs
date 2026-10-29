// @ts-check
/**
 * The one source of randomness of the generator. A string seed drives mulberry32, so the same
 * seed always yields the same people, companies and documents, in the browser and in Bun alike.
 */

/**
 * @typedef {object} Rng
 * @property {string} seed The seed this stream started from.
 * @property {() => number} next A float in [0, 1).
 * @property {(min: number, max: number) => number} int An integer in [min, max], both ends included.
 * @property {<T>(list: readonly T[]) => T} pick One element of a non-empty list.
 * @property {(p?: number) => boolean} bool True with probability `p` (default 0.5).
 * @property {(n: number) => string} digits `n` decimal digits.
 */

/** FNV-1a over the seed's characters: the 32-bit state mulberry32 starts from. */
function hashSeed(seed) {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A deterministic stream from a seed.
 * @param {string | number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  const text = String(seed)
  let state = hashSeed(text)

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** @param {number} min @param {number} max */
  const int = (min, max) => min + Math.floor(next() * (max - min + 1))

  return {
    seed: text,
    next,
    int,
    pick(list) {
      if (list.length === 0) throw new Error('pick from an empty list')
      return /** @type {any} */ (list[int(0, list.length - 1)])
    },
    bool: (p = 0.5) => next() < p,
    digits(n) {
      let out = ''
      for (let i = 0; i < n; i++) out += String(int(0, 9))
      return out
    },
  }
}

const SEED_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A fresh 8-character seed from the platform's crypto source: the only unseeded call of the core. */
export function randomSeed() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += SEED_ALPHABET[b % SEED_ALPHABET.length]
  return out
}
