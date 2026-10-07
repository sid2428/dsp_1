import { describe, expect, it } from 'vitest'
import { designBandpass, fftConvolveSame, frequencyResponse } from './fir'

const SR = 44100

function responseAt(h: Float64Array, hz: number) {
  const r = frequencyResponse(h, SR, 2206) // ~10 Hz grid
  let best = 0
  r.freqs.forEach((f, i) => {
    if (Math.abs(f - hz) < Math.abs(r.freqs[best] - hz)) best = i
  })
  return r.magDb[best]
}

describe('windowed-sinc band-pass', () => {
  const h = designBandpass(1023, 300, 3400, SR)

  it('is linear phase (symmetric taps)', () => {
    for (let i = 0; i < h.length; i++) expect(h[i]).toBeCloseTo(h[h.length - 1 - i], 12)
  })

  it('passes speech and rejects out-of-band content', () => {
    expect(Math.abs(responseAt(h, 1000))).toBeLessThan(0.2)
    expect(Math.abs(responseAt(h, 2500))).toBeLessThan(0.2)
    expect(responseAt(h, 50)).toBeLessThan(-40)
    expect(responseAt(h, 6000)).toBeLessThan(-40)
    expect(responseAt(h, 17000)).toBeLessThan(-40)
  })

  it('fast convolution keeps an in-band tone aligned and at unity gain', () => {
    const x = Float32Array.from({ length: 8192 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / SR))
    const y = fftConvolveSame(x, h)
    for (let i = 2000; i < 6000; i += 97) expect(y[i]).toBeCloseTo(x[i], 2)
  })

  it('validates its arguments', () => {
    expect(() => designBandpass(1024, 300, 3400, SR)).toThrow(/odd/)
    expect(() => designBandpass(101, 3400, 300, SR)).toThrow()
  })
})
