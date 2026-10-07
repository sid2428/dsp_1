import { describe, expect, it } from 'vitest'
import { correlation, gainMatchedSnrDb, segmentalSnrDb, snrDb, spectrogram, welchPsd } from './analysis'

const SR = 44100
const tone = (hz: number, len: number, amp = 0.5) => Float32Array.from({ length: len }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR))

describe('quality metrics', () => {
  const x = tone(440, 8192)

  it('identical signals: infinite SNR, correlation 1', () => {
    expect(snrDb(x, x)).toBe(Infinity)
    expect(correlation(x, x)).toBeCloseTo(1, 12)
  })

  it('gain matching ignores pure volume changes', () => {
    const quieter = x.map((v) => v * 0.25)
    expect(snrDb(x, quieter)).toBeLessThan(3)
    expect(gainMatchedSnrDb(x, quieter)).toBeGreaterThan(100)
    expect(segmentalSnrDb(x, quieter)).toBe(35)
  })
})

describe('spectral displays', () => {
  it('Welch PSD peaks at the tone frequency, also with a frame cap', () => {
    const x = tone(5000, SR * 2)
    for (const maxFrames of [Infinity, 16]) {
      const { freqs, db } = welchPsd(x, SR, 2048, 0.5, maxFrames)
      let best = 0
      db.forEach((v, i) => {
        if (v > db[best]) best = i
      })
      expect(Math.abs(freqs[best] - 5000)).toBeLessThan(SR / 2048)
    }
  })

  it('spectrogram has the requested shape', () => {
    const s = spectrogram(tone(1000, SR), SR, 1024, 50)
    expect(s.cols).toBe(50)
    expect(s.bins).toBe(512)
    expect(s.db).toHaveLength(50 * 512)
    expect(s.duration).toBeCloseTo(1, 6)
  })
})
