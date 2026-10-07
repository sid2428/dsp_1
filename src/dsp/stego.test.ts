import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { correlation, gainMatchedSnrDb, reverse, segmentalSnrDb, snrDb } from './analysis'
import { applyChannel, CLEAN_CHANNEL } from './channel'
import { SAMPLE_RATE } from './constants'
import { decode, encode, reverseInFrequency } from './stego'
import { inverseRealFft, realFft } from './fft'
import { decodeWav16, encodeWav16 } from './wav'

function loadSample(name: string): Float32Array {
  const path = fileURLToPath(new URL(`../../public/samples/${name}`, import.meta.url))
  const b = readFileSync(path)
  const { samples, sampleRate } = decodeWav16(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  expect(sampleRate).toBe(SAMPLE_RATE)
  return samples
}

const cover = loadSample('cover-demo.wav')
const secret = loadSample('secret-demo.wav')
const KEY = 'dsp-cie-2026'

describe('audio-in-audio round trip', () => {
  const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit' })
  const reference = enc.stages['secret-bandlimited']

  it('produces a stego file the same length as the cover, close to it', () => {
    expect(enc.stages.stego.length).toBe(cover.length)
    const coverSnr = gainMatchedSnrDb(cover, enc.stages.stego)
    expect(coverSnr).toBeGreaterThan(15)
  })

  it('recovers the band-limited secret almost exactly with the right key (DIT and DIF)', () => {
    for (const fftKind of ['dit', 'dif'] as const) {
      const received = applyChannel(enc.stages.stego, CLEAN_CHANNEL)
      const dec = decode(received, SAMPLE_RATE, { key: KEY, fftKind })
      expect(gainMatchedSnrDb(reference, dec.stages.recovered)).toBeGreaterThan(25)
      expect(correlation(reference, dec.stages.recovered)).toBeGreaterThan(0.99)
    }
  })

  it('the de-inverted stage is the secret played backwards', () => {
    const dec = decode(enc.stages.stego, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
    expect(correlation(reverse(reference), dec.stages.deinverted)).toBeGreaterThan(0.99)
  })

  it('a wrong key yields unintelligible audio', () => {
    const dec = decode(enc.stages.stego, SAMPLE_RATE, { key: 'wrong-key', fftKind: 'dit' })
    expect(Math.abs(correlation(reference, dec.stages.recovered))).toBeLessThan(0.2)
    expect(segmentalSnrDb(reference, dec.stages.recovered)).toBeLessThan(2)
  })

  it('the scrambled baseband does not resemble the secret', () => {
    expect(Math.abs(correlation(reference, enc.stages['secret-permuted']))).toBeLessThan(0.1)
  })

  it('survives a moderately noisy channel and a WAV round trip', () => {
    const noisy = applyChannel(enc.stages.stego, { noiseSnrDb: 40, quantize16: true, gainDb: -6 })
    const viaWav = decodeWav16(encodeWav16(noisy, SAMPLE_RATE)).samples
    const dec = decode(viaWav, SAMPLE_RATE, { key: KEY, fftKind: 'dit' })
    expect(correlation(reference, dec.stages.recovered)).toBeGreaterThan(0.9)
    expect(snrDb(reference, reference)).toBe(Infinity)
  })

  it('rejects empty keys and silent input', () => {
    expect(() => encode(cover, secret, SAMPLE_RATE, { key: ' ', strengthDb: -20, fftKind: 'dit' })).toThrow(/key/)
    expect(() => encode(new Float32Array(1000), secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit' })).toThrow(
      /silent/,
    )
  })
})

describe('frequency-domain time reversal', () => {
  it('X*[k]·e^{-j2πk(L-1)/N} is the spectrum of the reversed signal', () => {
    const L = 100
    const n = 256
    const x = Float32Array.from({ length: L }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9))
    const viaFreq = inverseRealFft(reverseInFrequency(realFft(x, n), L), L)
    const direct = reverse(x)
    for (let i = 0; i < L; i++) expect(viaFreq[i]).toBeCloseTo(direct[i], 9)
  })
})
