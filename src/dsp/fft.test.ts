import { describe, expect, it } from 'vitest'
import { bitReverse, dft, fft, fftTwoReal, inverseManyReal, nextPow2, realFft, traceFft, type FftKind } from './fft'
import { mulberry32 } from './prng'

function randomSignal(n: number, seed: number) {
  const r = mulberry32(seed)
  return { re: Float64Array.from({ length: n }, () => r() * 2 - 1), im: Float64Array.from({ length: n }, () => r() * 2 - 1) }
}

const maxErr = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

describe.each<FftKind>(['dit', 'dif'])('radix-2 %s FFT', (kind) => {
  it.each([2, 8, 16, 64, 256])('matches the naive DFT for N=%i', (n) => {
    const x = randomSignal(n, n)
    const ref = dft(x.re, x.im)
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im, { kind })
    expect(maxErr(re, ref.re)).toBeLessThan(1e-9)
    expect(maxErr(im, ref.im)).toBeLessThan(1e-9)
  })

  it('inverse FFT restores the input', () => {
    const x = randomSignal(1024, 7)
    const re = Float64Array.from(x.re)
    const im = Float64Array.from(x.im)
    fft(re, im, { kind })
    fft(re, im, { kind, inverse: true })
    expect(maxErr(re, x.re)).toBeLessThan(1e-12)
    expect(maxErr(im, x.im)).toBeLessThan(1e-12)
  })

  it('executes (N/2) log2 N butterflies', () => {
    let count = 0
    fft(new Float64Array(64), new Float64Array(64), { kind, onButterfly: () => count++ })
    expect(count).toBe(32 * 6)
  })

  it('trace has one column per stage plus input, ending at the DFT', () => {
    const input = [1, 2, 3, 4, 0, -1, -2, 0.5]
    const t = traceFft(input, kind)
    expect(t.columns).toHaveLength(4)
    expect(t.butterflies.every((s) => s.length === 4)).toBe(true)
    const ref = dft(input, new Array(8).fill(0))
    const last = t.columns[3]
    t.outputOrder.forEach((k, slot) => {
      expect(last.re[slot]).toBeCloseTo(ref.re[k], 9)
      expect(last.im[slot]).toBeCloseTo(ref.im[k], 9)
    })
  })
})

describe('time-reversal property', () => {
  it('reversing a real signal (circularly) conjugates its spectrum', () => {
    const n = 32
    const x = randomSignal(n, 3).re
    const xr = Float64Array.from({ length: n }, (_, i) => x[(n - i) % n])
    const a = { re: Float64Array.from(x), im: new Float64Array(n) }
    const b = { re: xr, im: new Float64Array(n) }
    fft(a.re, a.im)
    fft(b.re, b.im)
    expect(maxErr(b.re, a.re)).toBeLessThan(1e-9)
    expect(maxErr(b.im, a.im.map((v) => -v))).toBeLessThan(1e-9)
  })
})

describe('helpers', () => {
  it('bitReverse and nextPow2', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => bitReverse(i, 3))).toEqual([0, 4, 2, 6, 1, 5, 3, 7])
    expect(nextPow2(441000)).toBe(524288)
    expect(nextPow2(1024)).toBe(1024)
  })

  it('rejects non power-of-two lengths', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(/power of two/)
  })
})

describe('two-for-one real FFT helpers', () => {
  it('fftTwoReal equals two separate FFTs', () => {
    const n = 256
    const x = randomSignal(n, 11).re
    const y = randomSignal(n, 12).re
    const [X, Y] = fftTwoReal(x, y, n)
    const a = { re: Float64Array.from(x), im: new Float64Array(n) }
    const b = { re: Float64Array.from(y), im: new Float64Array(n) }
    fft(a.re, a.im)
    fft(b.re, b.im)
    expect(maxErr(X.re, a.re)).toBeLessThan(1e-9)
    expect(maxErr(X.im, a.im)).toBeLessThan(1e-9)
    expect(maxErr(Y.re, b.re)).toBeLessThan(1e-9)
    expect(maxErr(Y.im, b.im)).toBeLessThan(1e-9)
  })

  it('inverseManyReal recovers an odd number of real signals', () => {
    const n = 128
    const sigs = [1, 2, 3].map((s) => randomSignal(n, s).re)
    const specs = sigs.map((x) => realFft(x, n))
    const back = inverseManyReal(specs, n)
    expect(back).toHaveLength(3)
    back.forEach((b, i) => expect(maxErr(b, sigs[i])).toBeLessThan(1e-6))
  })
})
