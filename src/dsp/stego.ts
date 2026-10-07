import { energy, normalizePeak, peak, reverse } from './analysis'
import { computeLaneLayout, laneAmplitude, readLane, writeLane, type LaneLayout, type LaneReadout } from './bit-lane'
import { FIR_TAPS, LANE_STRENGTH_DB, SECRET_HIGH_HZ, SECRET_LOW_HZ } from './constants'
import { fft, fftTwoReal, inverseManyReal, log2Int, nextPow2, realFft, type FftKind, type Spectrum } from './fft'
import { designBandpass } from './fir'
import { keyedPermutation } from './prng'
import {
  addBand,
  bandEnergy,
  clearBand,
  cloneSpectrum,
  computeLayout,
  emptySpectrum,
  invertBand,
  permuteBand,
  scaleBand,
  spectrumWithBand,
  takeBand,
  unpermuteBand,
  type Band,
  type BandLayout,
} from './spectral-ops'

export type EncodeStageId =
  | 'cover'
  | 'secret'
  | 'secret-bandlimited'
  | 'secret-reversed'
  | 'secret-inverted'
  | 'secret-permuted'
  | 'secret-shifted'
  | 'cover-cleared'
  | 'text-lane'
  | 'stego'

export type DecodeStageId = 'received' | 'band-extracted' | 'baseband' | 'depermuted' | 'deinverted' | 'recovered' | 'text-lane'

export interface EncodeParams {
  key: string
  /** Level of the hidden band relative to the cover, in dB (negative = quieter). */
  strengthDb: number
  fftKind: FftKind
  /** Framed bitstream (header + encrypted text) for the hidden text lane, if any. */
  textBits?: Uint8Array | null
}

export interface EncodeResult {
  stages: Record<EncodeStageId, Float32Array>
  layout: BandLayout
  permutation: number[]
  fir: Float64Array
  gain: number
  /** Extra scale applied to the whole stego file to avoid clipping (1 = none). */
  clipScale: number
  secretTruncated: boolean
  lane: { layout: LaneLayout; bits: Uint8Array | null; amplitude: number }
}

export interface DecodeParams {
  key: string
  fftKind: FftKind
  /** Also decode with this (wrong) key, reusing the same FFT, for comparison. */
  wrongKey?: string
}

export interface DecodeResult {
  stages: Record<DecodeStageId, Float32Array>
  /** Recovered audio when decoding with `params.wrongKey`, if requested. */
  wrongKeyRecovered: Float32Array | null
  laneLayout: LaneLayout
  lane: LaneReadout
  wrongLane: LaneReadout | null
  layout: BandLayout
  permutation: number[]
  fftMs: number
  fftSize: number
  fftStages: number
  butterflyCount: number
}

/**
 * FFT size used by both ends: big enough that the FIR's linear convolution does not wrap around.
 * Sender and receiver derive it from the clip length alone, so they agree on every bin position.
 */
export function fftSizeFor(length: number): number {
  return nextPow2(length + FIR_TAPS)
}

function fitLength(x: Float32Array, length: number): Float32Array {
  if (x.length === length) return x
  const out = new Float32Array(length)
  out.set(x.subarray(0, Math.min(length, x.length)))
  return out
}

export function assertKey(key: string): void {
  if (key.trim().length === 0) throw new Error('A secret key is required')
}

/** Multiplies a spectrum by e^{j·2π·k·shift/N}: a circular time advance by `shift` samples. */
function advance(spec: Spectrum, shift: number): void {
  const { n } = spec
  for (let k = 0; k < n; k++) {
    const ang = (2 * Math.PI * k * shift) / n
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const r = spec.re[k] * c - spec.im[k] * s
    spec.im[k] = spec.re[k] * s + spec.im[k] * c
    spec.re[k] = r
  }
}

/**
 * Time reversal done in the frequency domain. For a real x[n] living in 0..L-1,
 * y[n] = x[L-1-n]  ⟷  Y[k] = X*[k] · e^{-j2πk(L-1)/N}.
 */
export function reverseInFrequency(spec: Spectrum, length: number): Spectrum {
  const out = cloneSpectrum(spec)
  for (let k = 0; k < out.n; k++) out.im[k] = -out.im[k]
  advance(out, -(length - 1))
  return out
}

/**
 * Sender pipeline:
 *   secret -> FIR band-pass (300-3400 Hz) -> time reversal -> FFT -> spectral inversion
 *          -> keyed sub-band permutation -> shift to 16.5 kHz (scaled) -> + cover (band cleared) -> IFFT
 * Implemented with 5 FFTs of size N: one two-for-one FFT (secret + cover), one for the FIR, and
 * three two-for-one inverse FFTs that produce the six time-domain signals shown in the UI.
 */
export function encode(cover: Float32Array, secret: Float32Array, sampleRate: number, params: EncodeParams): EncodeResult {
  assertKey(params.key)
  if (cover.length === 0 || secret.length === 0) throw new Error('Cover and secret audio must not be empty')
  if (peak(cover) === 0) throw new Error('Cover audio is silent')
  if (peak(secret) === 0) throw new Error('Secret audio is silent')

  const length = cover.length
  const secretTruncated = secret.length > length
  const secretFit = fitLength(secret, length)
  const kind = params.fftKind
  const n = fftSizeFor(length)
  const layout = computeLayout(n, sampleRate)
  const { baseLow, carrierLow, width, subbandWidth, subbands } = layout

  // 1) secret and cover spectra from one complex FFT
  const [secretSpec, coverSpec] = fftTwoReal(secretFit, cover, n, kind)

  // 2) FIR band-pass as a multiplication, then undo the filter's (taps-1)/2 group delay
  const fir = designBandpass(FIR_TAPS, SECRET_LOW_HZ, SECRET_HIGH_HZ, sampleRate)
  const firSpec = realFft(fir, n, kind)
  const bandlimitedSpec: Spectrum = { re: new Float64Array(n), im: new Float64Array(n), n }
  for (let k = 0; k < n; k++) {
    bandlimitedSpec.re[k] = secretSpec.re[k] * firSpec.re[k] - secretSpec.im[k] * firSpec.im[k]
    bandlimitedSpec.im[k] = secretSpec.re[k] * firSpec.im[k] + secretSpec.im[k] * firSpec.re[k]
  }
  advance(bandlimitedSpec, (FIR_TAPS - 1) / 2)

  // 3) time reversal via the conjugation property
  const reversedSpec = reverseInFrequency(bandlimitedSpec, length)

  // 4) scramble in the speech band
  const band = takeBand(reversedSpec, baseLow, width)
  const inverted = invertBand(band)
  const permutation = keyedPermutation(params.key, subbands)
  const permuted = permuteBand(inverted, permutation, subbandWidth)

  // 5) clear the carrier band in the cover, scale and park the secret there
  const coverCleared = cloneSpectrum(coverSpec)
  clearBand(coverCleared, carrierLow, width)
  const laneLayout = computeLaneLayout(n, sampleRate)
  clearBand(coverCleared, laneLayout.start, laneLayout.width)
  const secretE = bandEnergy(permuted, n)
  if (secretE === 0) throw new Error('Secret has no energy in the 300-3400 Hz speech band')
  const gain = Math.sqrt((energy(cover) * 10 ** (params.strengthDb / 10)) / secretE)
  const scaled = scaleBand(permuted, gain)
  const stegoSpec = cloneSpectrum(coverCleared)
  addBand(stegoSpec, carrierLow, scaled)

  // 6) hidden text lane: spread BPSK symbols at 20.1-21.9 kHz
  const textBits = params.textBits ?? null
  const laneAmp = laneAmplitude(energy(cover), laneLayout, n, LANE_STRENGTH_DB)
  const laneSpec = emptySpectrum(n)
  if (textBits && textBits.length > 0) {
    writeLane(laneSpec, laneLayout, textBits, params.key, laneAmp)
    writeLane(stegoSpec, laneLayout, textBits, params.key, laneAmp)
  }

  // 7) back to time: seven real signals from four complex IFFTs
  const [bandlimited, invertedT, permutedT, shiftedT, coverClearedT, stegoRaw, laneT] = inverseManyReal(
    [
      bandlimitedSpec,
      spectrumWithBand(n, baseLow, inverted),
      spectrumWithBand(n, baseLow, permuted),
      spectrumWithBand(n, carrierLow, scaled),
      coverCleared,
      stegoSpec,
      laneSpec,
    ],
    length,
    kind,
  )
  const p = peak(stegoRaw)
  const clipScale = p > 0.99 ? 0.99 / p : 1
  const limit = (x: Float32Array) => (clipScale === 1 ? x : x.map((v) => v * clipScale))

  return {
    stages: {
      cover,
      secret: secretFit,
      'secret-bandlimited': bandlimited,
      'secret-reversed': reverse(bandlimited),
      'secret-inverted': invertedT,
      'secret-permuted': permutedT,
      'secret-shifted': limit(shiftedT),
      'cover-cleared': limit(coverClearedT),
      'text-lane': limit(laneT),
      stego: limit(stegoRaw),
    },
    layout,
    permutation,
    fir,
    gain,
    clipScale,
    secretTruncated,
    lane: { layout: laneLayout, bits: textBits, amplitude: laneAmp * clipScale },
  }
}

/** Undo the key-dependent scrambling on the extracted band (still in the frequency domain). */
function unscramble(band: Band, layout: BandLayout, key: string) {
  const permutation = keyedPermutation(key, layout.subbands)
  const depermuted = unpermuteBand(band, permutation, layout.subbandWidth)
  return { permutation, depermuted, deinverted: invertBand(depermuted) }
}

/**
 * Receiver pipeline (exact mirror of the sender):
 *   received -> FFT (radix-2 DIT or DIF) -> take 16.5 kHz band (FFT band-pass) -> shift down to 150 Hz
 *            -> inverse permutation (key) -> spectral inversion -> IFFT -> time reversal -> recovered voice
 */
export function decode(received: Float32Array, sampleRate: number, params: DecodeParams): DecodeResult {
  assertKey(params.key)
  if (received.length === 0) throw new Error('Received audio is empty')
  const length = received.length
  const kind = params.fftKind
  const n = fftSizeFor(length)
  const layout = computeLayout(n, sampleRate)
  const { baseLow, carrierLow, width } = layout

  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < length; i++) re[i] = received[i]
  const t0 = performance.now()
  fft(re, im, { kind })
  const fftMs = performance.now() - t0
  const spec: Spectrum = { re, im, n }

  const band = takeBand(spec, carrierLow, width)
  const right = unscramble(band, layout, params.key)
  const wrong = params.wrongKey ? unscramble(band, layout, params.wrongKey) : null

  // the same FFT also carries the hidden text lane
  const laneLayout = computeLaneLayout(n, sampleRate)
  const lane = readLane(spec, laneLayout, params.key)
  const wrongLane = params.wrongKey ? readLane(spec, laneLayout, params.wrongKey) : null

  const [bandExtracted, baseband, depermuted, deinverted, laneT, wrongDeinverted] = inverseManyReal(
    [
      spectrumWithBand(n, carrierLow, band),
      spectrumWithBand(n, baseLow, band),
      spectrumWithBand(n, baseLow, right.depermuted),
      spectrumWithBand(n, baseLow, right.deinverted),
      spectrumWithBand(n, laneLayout.start, takeBand(spec, laneLayout.start, laneLayout.width)),
      ...(wrong ? [spectrumWithBand(n, baseLow, wrong.deinverted)] : []),
    ],
    length,
    kind,
  )

  return {
    stages: {
      received,
      'band-extracted': bandExtracted,
      baseband,
      depermuted,
      deinverted,
      recovered: normalizePeak(reverse(deinverted), 0.9),
      'text-lane': laneT,
    },
    wrongKeyRecovered: wrongDeinverted ? normalizePeak(reverse(wrongDeinverted), 0.9) : null,
    laneLayout,
    lane,
    wrongLane,
    layout,
    permutation: right.permutation,
    fftMs,
    fftSize: n,
    fftStages: log2Int(n),
    butterflyCount: (n / 2) * log2Int(n),
  }
}
