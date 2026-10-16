import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bandSnrDb, correlation, energy, welchPsd } from './analysis'
import { computeLaneLayout, frameBits, MAGIC_TEXT_ONLY, MAGIC_VOICE_ONLY, payloadCapacityBytes, readLane } from './bit-lane'
import { applyChannel, CLEAN_CHANNEL } from './channel'
import { SAMPLE_RATE } from './constants'
import { CRYPTO_OVERHEAD, decryptText, encryptText } from './crypto'
import { realFft } from './fft'
import { gaussianNoise } from './prng'
import { decode, encode, fftSizeFor, type EncodeProgressStage } from './stego'
import { decodeWav16, encodeWav16, encodeWavFloat32 } from './wav'

function loadSample(name: string): Float32Array {
  const b = readFileSync(fileURLToPath(new URL(`../../public/samples/${name}`, import.meta.url)))
  return decodeWav16(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).samples
}

const cover = loadSample('cover-demo.wav')
const secret = loadSample('secret-demo.wav')
const KEY = 'pipeline-key'
const layout = computeLaneLayout(fftSizeFor(cover.length), SAMPLE_RATE)
const textLimit = payloadCapacityBytes(layout) - CRYPTO_OVERHEAD

/** Sender → 16-bit WAV file → receiver, exactly as an exported file would travel. */
function viaWavFile(x: Float32Array): Float32Array {
  return decodeWav16(encodeWav16(x, SAMPLE_RATE)).samples
}

async function decodeText(rx: Float32Array, key: string) {
  const dec = decode(rx, SAMPLE_RATE, { key, fftKind: 'dit' })
  const text = dec.lane.status === 'ok' && dec.lane.payload && dec.lane.payload.length > 0 ? await decryptText(dec.lane.payload, key) : null
  return { dec, text }
}

describe('frame content flags', () => {
  it('text-only frame: text round-trips through a WAV file and the frame says no voice was sent', async () => {
    const message = 'Text only — no voice ✓'
    const bits = frameBits(await encryptText(message, KEY), layout, 'text')
    const enc = encode(cover, null, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: bits })
    expect(enc.hasVoice).toBe(false)
    const { dec, text } = await decodeText(viaWavFile(enc.stages.stego), KEY)
    expect(dec.lane.content).toBe('text')
    expect(dec.lane.headerMagic).toBe(MAGIC_TEXT_ONLY)
    expect(text).toBe(message)
    // the carrier band was cleared and left empty
    expect(energy(dec.stages['band-extracted']) / energy(enc.stages.stego)).toBeLessThan(1e-6)
  })

  it('voice-only frame: the AES-GCM key token authenticates the right key and rejects a wrong one', async () => {
    const token = await encryptText('', KEY)
    const bits = frameBits(token, layout, 'voice')
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: bits })
    const rx = viaWavFile(enc.stages.stego)
    const right = decode(rx, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
    expect(right.lane.status).toBe('ok')
    expect(right.lane.content).toBe('voice')
    expect(right.lane.headerMagic).toBe(MAGIC_VOICE_ONLY)
    expect(await decryptText(right.lane.payload!, KEY)).toBe('')
    expect(correlation(enc.stages['secret-bandlimited'], right.stages.recovered)).toBeGreaterThan(0.99)
    const wrong = decode(rx, SAMPLE_RATE, { key: `${KEY}x`, fftKind: 'dif' })
    expect(wrong.lane.status).toBe('no-payload')
    // even if a wrong key's chips happened to sync, the tag would not verify
    await expect(decryptText(right.lane.payload!, `${KEY}x`)).rejects.toThrow()
  })

  it('original-format files still decode: voice-only without any frame, and 0xA5 voice + text', async () => {
    const legacyVoice = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit' })
    const d1 = decode(viaWavFile(legacyVoice.stages.stego), SAMPLE_RATE, { key: KEY, fftKind: 'dit' })
    expect(d1.lane.status).toBe('no-payload')
    expect(correlation(legacyVoice.stages['secret-bandlimited'], d1.stages.recovered)).toBeGreaterThan(0.99)
    const legacyBoth = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: frameBits(await encryptText('legacy', KEY), layout) })
    const { dec, text } = await decodeText(viaWavFile(legacyBoth.stages.stego), KEY)
    expect(dec.lane.content).toBe('voice+text')
    expect(text).toBe('legacy')
  })

  it('rejects frames whose payload contradicts their flag', () => {
    expect(() => frameBits(new Uint8Array(0), layout, 'voice')).toThrow()
    expect(() => frameBits(new Uint8Array(0), layout, 'text')).toThrow()
  })

  it('refuses to encode when there is nothing to hide', () => {
    expect(() => encode(cover, null, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit' })).toThrow(/Nothing to hide/)
  })

  it('reports real encode stages in execution order', () => {
    const seen: EncodeProgressStage[] = []
    encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', onProgress: (s, ms) => (expect(ms).toBeGreaterThanOrEqual(0), seen.push(s)) })
    expect(seen).toEqual(['fft', 'fir', 'reverse', 'scramble', 'embed', 'lane', 'ifft'])
  })
})

describe('UTF-8 text at the capacity boundary', () => {
  it('a message of exactly the limit (multi-byte characters) survives the full file round trip', async () => {
    // 4-byte emoji fill the budget; pad with ASCII to hit it exactly
    const emoji = '🎧'.repeat(Math.floor(textLimit / 4))
    const message = emoji + 'x'.repeat(textLimit - new TextEncoder().encode(emoji).length)
    expect(new TextEncoder().encode(message).length).toBe(textLimit)
    const bits = frameBits(await encryptText(message, KEY), layout, 'voice+text')
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: bits })
    const { text } = await decodeText(viaWavFile(enc.stages.stego), KEY)
    expect(text).toBe(message)
  })

  it('one byte over the limit cannot be framed', async () => {
    const cipher = await encryptText('x'.repeat(textLimit + 1), KEY)
    expect(() => frameBits(cipher, layout)).toThrow(/can carry only/)
  })
})

describe('channel effects actually change the audio and recovery', () => {
  const bitsP = encryptText('channel test', KEY).then((c) => frameBits(c, layout))

  it('a 16 kHz low-pass (lossy-codec model) destroys both hidden lanes', async () => {
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: await bitsP })
    const rx = applyChannel(enc.stages.stego, { ...CLEAN_CHANNEL, lowpassHz: 16000 })
    // the audible cover is nearly untouched...
    expect(correlation(enc.stages.stego, rx)).toBeGreaterThan(0.95)
    // ...but the hidden bands are gone
    expect(bandSnrDb(enc.stages.stego, rx, SAMPLE_RATE, 16500, 19900)).toBeLessThan(1)
    const dec = decode(rx, SAMPLE_RATE, { key: KEY, fftKind: 'dit' })
    expect(dec.lane.status).toBe('no-payload')
    expect(Math.abs(correlation(enc.stages['secret-bandlimited'], dec.stages.recovered))).toBeLessThan(0.3)
  })

  it('different seeds give different noise; the same seed is reproducible', () => {
    const x = cover.subarray(0, 44100)
    const a = applyChannel(x, { noiseSnrDb: 20, quantize16: false, gainDb: 0, seed: 1 })
    const b = applyChannel(x, { noiseSnrDb: 20, quantize16: false, gainDb: 0, seed: 2 })
    const a2 = applyChannel(x, { noiseSnrDb: 20, quantize16: false, gainDb: 0, seed: 1 })
    expect(Array.from(a)).toEqual(Array.from(a2))
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('receiver robustness', () => {
  it('ordinary audio with no hidden content decodes without throwing and reports no text', () => {
    const noise = gaussianNoise(cover.length, 5).map((v) => v * 0.1)
    const dec = decode(noise, SAMPLE_RATE, { key: KEY, fftKind: 'dit' })
    expect(dec.lane.status).toBe('no-payload')
  })

  it('a trimmed file still decodes while the FFT size is unchanged, because the lane bins are stationary', async () => {
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: frameBits(await encryptText('hi', KEY), layout) })
    const trimmed = enc.stages.stego.slice(0, Math.floor(cover.length * 0.6))
    expect(fftSizeFor(trimmed.length)).toBe(fftSizeFor(cover.length))
    const { text } = await decodeText(trimmed, KEY)
    expect(text).toBe('hi')
  })

  it('a length change that alters the FFT size breaks sync', async () => {
    const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: -20, fftKind: 'dit', textBits: frameBits(await encryptText('hi', KEY), layout) })
    const short = enc.stages.stego.slice(0, Math.floor(fftSizeFor(cover.length) / 2 - 2048))
    expect(fftSizeFor(short.length)).not.toBe(fftSizeFor(cover.length))
    expect(readLane(realFft(short, fftSizeFor(short.length)), computeLaneLayout(fftSizeFor(short.length), SAMPLE_RATE), KEY).status).toBe('no-payload')
  })
})

describe('file formats and display maths', () => {
  it('32-bit float WAV is bit-exact', () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.1) * 0.7)
    expect(Array.from(decodeWav16(encodeWavFloat32(x, SAMPLE_RATE)).samples)).toEqual(Array.from(x))
  })

  it('density-scaled PSD integrates to the signal power', () => {
    const x = gaussianNoise(SAMPLE_RATE * 2, 3).map((v) => v * 0.25)
    const { db } = welchPsd(x, SAMPLE_RATE, 2048, 0.5, Infinity, 'density')
    const df = SAMPLE_RATE / 2048
    let total = 0
    for (let k = 0; k < db.length; k++) total += 10 ** (db[k] / 10) * df
    const power = energy(x) / x.length
    expect(10 * Math.log10(total / power)).toBeCloseTo(0, 0)
  })
})
