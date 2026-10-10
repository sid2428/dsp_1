import { describe, expect, it } from 'vitest'
import { correlation, energy, gainMatchedSnrDb, snrDb } from '../src/dsp/analysis'
import { bitErrorRate, computeLaneLayout, frameBits, payloadCapacityBytes } from '../src/dsp/bit-lane'
import { applyChannel, type ChannelParams } from '../src/dsp/channel'
import { decryptText, encryptText } from '../src/dsp/crypto'
import { SAMPLE_RATE } from '../src/dsp/constants'
import { decode, encode, fftSizeFor } from '../src/dsp/stego'
import { decodeWav16, encodeWav16 } from '../src/dsp/wav'

const DURATION_SECONDS = 4
const SIGNAL_LENGTH = SAMPLE_RATE * DURATION_SECONDS
const KEY = 'spectra-hide-baseline-key'
const TEXT = 'DSP baseline: text lane.'
const STRENGTHS_DB = [-12, -20, -28] as const
const NOISE_LEVELS_DB = [40, 30, 20, 10] as const

interface Metric {
  value: number | null
  note?: 'exact match' | 'zero energy'
}

interface RecoveryResult {
  snrDb: Metric
  correlation: Metric
}

interface TextResult {
  success: boolean
  failure: string | null
}

interface BaselineResult {
  label: string
  strengthDb: number
  coverSnrDb: Metric
  coverGainMatchedSnrDb: Metric
  secret: RecoveryResult | null
  text: TextResult | null
  error: string | null
}

/** Deterministic, non-silent synthetic cover and secret signals. */
function makeSignals(): { cover: Float32Array; secret: Float32Array } {
  const cover = new Float32Array(SIGNAL_LENGTH)
  const secret = new Float32Array(SIGNAL_LENGTH)
  for (let i = 0; i < SIGNAL_LENGTH; i++) {
    const t = i / SAMPLE_RATE
    const envelope = 0.82 + 0.12 * Math.sin(2 * Math.PI * 0.7 * t)
    cover[i] = envelope * (0.38 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 880 * t))
    secret[i] = (0.65 + 0.15 * Math.sin(2 * Math.PI * 0.45 * t)) * (0.42 * Math.sin(2 * Math.PI * 620 * t) + 0.2 * Math.sin(2 * Math.PI * 1450 * t) + 0.1 * Math.sin(2 * Math.PI * 2500 * t))
  }
  return { cover, secret }
}

function align(a: ArrayLike<number>, b: ArrayLike<number>): [Float32Array, Float32Array] {
  const length = Math.min(a.length, b.length)
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    left[i] = a[i]
    right[i] = b[i]
  }
  return [left, right]
}

/** The analysis helpers intentionally return Infinity for a perfect match; reports use null for zero-energy inputs. */
function safeMetrics(reference: ArrayLike<number>, test: ArrayLike<number>): RecoveryResult {
  const [a, b] = align(reference, test)
  if (a.length === 0 || energy(a) === 0 || energy(b) === 0) return { snrDb: { value: null, note: 'zero energy' }, correlation: { value: null, note: 'zero energy' } }
  const snr = gainMatchedSnrDb(a, b)
  const corr = correlation(a, b)
  return {
    snrDb: Number.isFinite(snr) ? { value: snr } : { value: null, note: 'exact match' },
    correlation: Number.isFinite(corr) ? { value: corr } : { value: null, note: 'exact match' },
  }
}

function safePlainSnr(reference: ArrayLike<number>, test: ArrayLike<number>): Metric {
  const [a, b] = align(reference, test)
  if (a.length === 0 || energy(a) === 0 || energy(b) === 0) return { value: null, note: 'zero energy' }
  const snr = snrDb(a, b)
  return Number.isFinite(snr) ? { value: snr } : { value: null, note: 'exact match' }
}

function formatMetric(metric: Metric, digits = 2): string {
  return metric.value === null ? metric.note ?? 'n/a' : metric.value.toFixed(digits)
}

function describeChannel(params: ChannelParams): string {
  const noise = params.noiseSnrDb === null ? 'clean' : `AWGN ${params.noiseSnrDb} dB SNR`
  const quantization = params.quantize16 ? ', 16-bit PCM' : ''
  const gain = params.gainDb === 0 ? '' : `, gain ${params.gainDb > 0 ? '+' : ''}${params.gainDb} dB`
  return `${noise}${gain}${quantization}`
}

async function recoverText(received: Float32Array): Promise<TextResult> {
  try {
    const decoded = decode(received, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
    if (decoded.lane.status !== 'ok' || !decoded.lane.payload) return { success: false, failure: `lane ${decoded.lane.status}` }
    const recovered = await decryptText(decoded.lane.payload, KEY)
    return recovered === TEXT ? { success: true, failure: null } : { success: false, failure: 'plaintext mismatch' }
  } catch (error) {
    return { success: false, failure: error instanceof Error ? error.message : String(error) }
  }
}

function printRecovery(label: string, result: RecoveryResult): void {
  console.log(`  ${label}: SNR ${formatMetric(result.snrDb)} dB, correlation ${formatMetric(result.correlation, 4)}`)
}

function printTextSummary(label: string, results: TextResult[]): void {
  const successes = results.filter((result) => result.success).length
  console.log(`  ${label}: ${successes}/${results.length} exact matches, ${results.length - successes} failures`)
}

describe('DSP performance baseline experiment', () => {
  it('measures the current implementation without changing its algorithm', async () => {
    const { cover, secret } = makeSignals()
    const layout = computeLaneLayout(fftSizeFor(cover.length), SAMPLE_RATE)
    const payloadCapacity = payloadCapacityBytes(layout)
    const cipher = await encryptText(TEXT, KEY)
    const bits = frameBits(cipher, layout)

    console.log('\nSpectraHide DSP performance baseline')
    console.log(`Signals: ${DURATION_SECONDS} s, ${SAMPLE_RATE} Hz, ${cover.length} samples, synthetic tones, key fixed`)
    console.log('Metrics: plain and gain-matched SNR in dB; correlation is normalized Pearson correlation [-1, 1]')
    console.log(`Text lane: ${new TextEncoder().encode(TEXT).length} plaintext bytes, capacity ${payloadCapacity} bytes after crypto overhead`)

    const strengthResults: BaselineResult[] = []
    for (const strengthDb of STRENGTHS_DB) {
      try {
        const enc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb, fftKind: 'dit', textBits: bits })
        const recovered = decode(enc.stages.stego, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
        const reference = enc.stages['secret-bandlimited']
        strengthResults.push({
          label: 'clean float',
          strengthDb,
          coverSnrDb: safePlainSnr(cover, enc.stages.stego),
          coverGainMatchedSnrDb: safeMetrics(cover, enc.stages.stego).snrDb,
          secret: safeMetrics(reference, recovered.stages.recovered),
          text: await recoverText(enc.stages.stego),
          error: null,
        })
      } catch (error) {
        strengthResults.push({ label: 'clean float', strengthDb, coverSnrDb: { value: null, note: 'zero energy' }, coverGainMatchedSnrDb: { value: null, note: 'zero energy' }, secret: null, text: null, error: error instanceof Error ? error.message : String(error) })
      }
    }

    console.log('\nEmbedding-strength trade-off')
    for (const result of strengthResults) {
      console.log(`  ${result.strengthDb} dB: cover SNR ${formatMetric(result.coverSnrDb)} dB (gain-matched ${formatMetric(result.coverGainMatchedSnrDb)} dB)`)
      if (result.secret) printRecovery('secret recovery', result.secret)
      console.log(`  text: ${result.text?.success ? 'exact match' : `FAILED (${result.text?.failure ?? result.error ?? 'encode/decode error'})`}`)
    }
    printTextSummary('strength text summary', strengthResults.flatMap((result) => (result.text ? [result.text] : [])))

    const baselineStrength = -20
    const encodeStarted = performance.now()
    const baselineEnc = encode(cover, secret, SAMPLE_RATE, { key: KEY, strengthDb: baselineStrength, fftKind: 'dit', textBits: bits })
    const encodeMs = performance.now() - encodeStarted
    const decodeStarted = performance.now()
    const baselineDecoded = decode(baselineEnc.stages.stego, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
    const decodeMs = performance.now() - decodeStarted
    console.log(`\nRuntime sample at ${baselineStrength} dB: encode ${encodeMs.toFixed(1)} ms; decode ${decodeMs.toFixed(1)} ms (FFT ${baselineDecoded.fftMs.toFixed(1)} ms)`)
    const channelCases: Array<{ label: string; params: ChannelParams; wavRoundTrip?: boolean }> = [
      { label: 'clean float', params: { noiseSnrDb: null, quantize16: false, gainDb: 0, seed: 1001 } },
      { label: 'clean + quantization', params: { noiseSnrDb: null, quantize16: true, gainDb: 0, seed: 1002 } },
      ...NOISE_LEVELS_DB.map((noiseSnrDb, index) => ({ label: `AWGN ${noiseSnrDb} dB`, params: { noiseSnrDb, quantize16: false, gainDb: 0, seed: 2000 + index } })),
      { label: 'volume scaling -6 dB', params: { noiseSnrDb: null, quantize16: false, gainDb: -6, seed: 3001 } },
      { label: '16-bit WAV round trip', params: { noiseSnrDb: null, quantize16: false, gainDb: 0, seed: 3002 }, wavRoundTrip: true },
    ]

    console.log(`\nChannel robustness at embedding strength ${baselineStrength} dB`)
    const channelTextResults: TextResult[] = []
    for (const testCase of channelCases) {
      let received: Float32Array
      try {
        received = applyChannel(baselineEnc.stages.stego, testCase.params)
        if (testCase.wavRoundTrip) received = decodeWav16(encodeWav16(received, SAMPLE_RATE)).samples
        const decoded = decode(received, SAMPLE_RATE, { key: KEY, fftKind: 'dif' })
        const secretMetrics = safeMetrics(baselineEnc.stages['secret-bandlimited'], decoded.stages.recovered)
        const text = await recoverText(received)
        channelTextResults.push(text)
        const channelMetrics = safePlainSnr(baselineEnc.stages.stego, received)
        console.log(`  ${testCase.label} (${describeChannel(testCase.params)}): channel SNR ${formatMetric(channelMetrics)} dB`)
        printRecovery('secret recovery', secretMetrics)
        console.log(`  text: ${text.success ? 'exact match' : `FAILED (${text.failure ?? 'unknown failure'})`}`)
      } catch (error) {
        channelTextResults.push({ success: false, failure: error instanceof Error ? error.message : String(error) })
        console.log(`  ${testCase.label}: FAILED (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    printTextSummary('channel text summary', channelTextResults)

    const quiet = new Float32Array(8)
    expect(safeMetrics(quiet, quiet)).toEqual({ snrDb: { value: null, note: 'zero energy' }, correlation: { value: null, note: 'zero energy' } })
    expect(bitErrorRate(bits, bits).errors).toBe(0)
    expect(baselineEnc.stages.stego.length).toBe(cover.length)
  }, 120_000)
})
