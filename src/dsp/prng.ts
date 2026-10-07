/** Deterministic, key-driven randomness so sender and receiver derive the same permutation. */

/** cyrb53-style string hash folded to an unsigned 32-bit seed. */
export function hashKey(key: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h1 ^ h2) >>> 0
}

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Key-seeded Fisher-Yates shuffle of [0..count). Re-draws until no sub-band stays in place
 * (a derangement) so every band is actually moved.
 */
export function keyedPermutation(key: string, count: number): number[] {
  const rand = mulberry32(hashKey(key))
  for (let attempt = 0; attempt < 64; attempt++) {
    const p = Array.from({ length: count }, (_, i) => i)
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = p[i]
      p[i] = p[j]
      p[j] = t
    }
    if (count < 2 || p.every((v, i) => v !== i)) return p
  }
  // fall back to a rotation, which is always a derangement
  return Array.from({ length: count }, (_, i) => (i + 1) % count)
}

export function invertPermutation(p: readonly number[]): number[] {
  const inv = new Array<number>(p.length)
  p.forEach((v, i) => {
    inv[v] = i
  })
  return inv
}

/** Standard normal samples via Box-Muller, deterministic for a given seed. */
export function gaussianNoise(length: number, seed: number): Float32Array {
  const rand = mulberry32(seed)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 2) {
    const u1 = Math.max(rand(), 1e-12)
    const u2 = rand()
    const r = Math.sqrt(-2 * Math.log(u1))
    out[i] = r * Math.cos(2 * Math.PI * u2)
    if (i + 1 < length) out[i + 1] = r * Math.sin(2 * Math.PI * u2)
  }
  return out
}
