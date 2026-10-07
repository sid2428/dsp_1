import { describe, expect, it } from 'vitest'
import { hashKey, invertPermutation, keyedPermutation } from './prng'

describe('keyed permutation', () => {
  it('is deterministic for a key and differs across keys', () => {
    expect(keyedPermutation('dsp-2026', 16)).toEqual(keyedPermutation('dsp-2026', 16))
    expect(keyedPermutation('dsp-2026', 16)).not.toEqual(keyedPermutation('dsp-2027', 16))
    expect(hashKey('a')).not.toBe(hashKey('b'))
  })

  it('is a derangement of 0..N-1 and inverts cleanly', () => {
    for (const key of ['alpha', 'beta', 'gamma', 'x']) {
      const p = keyedPermutation(key, 16)
      expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
      expect(p.every((v, i) => v !== i)).toBe(true)
      const inv = invertPermutation(p)
      p.forEach((v, i) => expect(inv[v]).toBe(i))
    }
  })
})
