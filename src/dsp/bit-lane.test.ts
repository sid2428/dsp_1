import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { correlation } from './analysis'
import { bitErrorRate, bitsToBytes, bytesToBits, computeLaneLayout, frameBits, payloadCapacityBytes } from './bit-lane'
import { applyChannel } from './channel'
import { SAMPLE_RATE } from './constants'
import { CRYPTO_OVERHEAD, decryptText, DecryptError, encryptText } from './crypto'
import { decode, encode, fftSizeFor } from './stego'
import { decodeWav16 } from './wav'

function loadSample(name: string): Float32Array {
  const b = readFileSync(fileURLToPath(new URL(`../../public/samples/${name}`, import.meta.url)))
  return decodeWav16(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).samples
}

describe('bit helpers', () => {
  it('bytes <-> bits round trip, MSB first', () => {
    const bytes = Uint8Array.of(0xa5, 0x00, 0xff, 0x3c)
    const bits = bytesToBits(bytes)
    expect(Array.from(bits.slice(0, 8))).toEqual([1, 0, 1, 0, 0, 1, 0, 1])
    expect(Array.from(bitsToBytes(bits))).toEqual(Array.from(bytes))
  })

  it('BER counts differing bits', () => {
    expect(bitErrorRate(Uint8Array.of(0, 1, 1, 0), Uint8Array.of(0, 0, 1, 1))).toEqual({ errors: 2, compared: 4, ber: 0.5 })
  })
})

describe('AES-GCM text encryption', () => {
  it('round trips UTF-8 text and adds a fixed overhead', async () => {
    const text = 'Meet at lab 4 — 5 PM ✓'
    const frame = await encryptText(text, 'k1')
    expect(frame.length).toBe(new TextEncoder().encode(text).length + CRYPTO_OVERHEAD)
    expect(await decryptText(frame, 'k1')).toBe(text)
  })

  it('detects a wrong key and a single flipped bit', async () => {
    const frame = await encryptText('secret', 'k1')
    await expect(decryptText(frame, 'k2')).rejects.toBeInstanceOf(DecryptError)
    const tampered = frame.slice()
    tampered[30] ^= 0x01
    await expect(decryptText(tampered, 'k1')).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('hidden text lane inside the stego file', () => {
  const cover = loadSample('cover-demo.wav')
  const secret = loadSample('secret-demo.wav')
  const KEY = 'lab-key-7'
  const TEXT = 'Meet the DSP team at lab 4 at 5 PM. Bring the FFT notes!'
  const layout = computeLaneLayout(fftSizeFor(cover.length), SAMPLE_RATE)

  it('has room for a useful message on the demo cover', () => {
    expect(payloadCapacityBytes(layout) - CRYPTO_OVERHEAD).toBeGreaterThan(100)
  })

  it('refuses a message that does not fit', () => {
    const tooBig = new Uint8Array(payloadCapacityBytes(layout) + 1)
    expect(() => frameBits(tooBig, layout)).toThrow(/can carry only/)
  })

  it('carries voice and text together; both survive a 20 dB noisy channel', async () => {
    const bits = frameBits(await encryptText(TEXT, KEY), layout)
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: bits })
    const reference = enc.stages['secret-bandlimited']

    for (const noiseSnrDb of [null, 30, 20]) {
      const rx = applyChannel(enc.stages.stego, { noiseSnrDb, quantize16: true, gainDb: -3 })
      const dec = decode(rx, SAMPLE_RATE, { key: KEY, fftKind: 'dif', wrongKey: `${KEY}?` })
      expect(dec.lane.status).toBe('ok')
      expect(bitErrorRate(bits, dec.lane.bits).errors).toBe(0)
      expect(await decryptText(dec.lane.payload!, KEY)).toBe(TEXT)
      expect(correlation(reference, dec.stages.recovered)).toBeGreaterThan(noiseSnrDb === 20 ? 0.6 : 0.95)
      // wrong key: chips differ, so the header does not even sync
      expect(dec.wrongLane?.status).toBe('no-payload')
    }
  })

  it('a very noisy channel corrupts bits and AES-GCM catches it', async () => {
    const bits = frameBits(await encryptText(TEXT, KEY), layout)
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: bits })
    const rx = applyChannel(enc.stages.stego, { noiseSnrDb: 0, quantize16: true, gainDb: 0 })
    const dec = decode(rx, SAMPLE_RATE, { key: KEY, fftKind: 'dit' })
    const ber = bitErrorRate(bits, dec.lane.bits).ber
    expect(ber).toBeGreaterThan(0)
    if (dec.lane.status === 'ok') await expect(decryptText(dec.lane.payload!, KEY)).rejects.toBeInstanceOf(DecryptError)
  })

  it('without text the lane reads as empty', () => {
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit' })
    expect(decode(enc.stages.stego, SAMPLE_RATE, { key: KEY, fftKind: 'dit' }).lane.status).toBe('no-payload')
  })
})
