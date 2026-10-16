import { energy } from './analysis'
import { SAMPLE_RATE } from './constants'
import { inverseRealFft, nextPow2, realFft } from './fft'
import { gaussianNoise } from './prng'

export interface ChannelParams {
  /** Additive white Gaussian noise level relative to the signal, or null for a clean channel. */
  noiseSnrDb: number | null
  /** Simulate saving/sending as a standard 16-bit PCM WAV. */
  quantize16: boolean
  /** Volume change applied by the channel, in dB. */
  gainDb: number
  /**
   * Brick-wall low-pass cut-off in Hz, or null for none. Lossy codecs (MP3, AAC, voice-note apps) usually
   * discard content above ~16 kHz; this models that one effect, which is what destroys the hidden lanes.
   */
  lowpassHz?: number | null
  seed?: number
}

export const CLEAN_CHANNEL: ChannelParams = { noiseSnrDb: null, quantize16: true, gainDb: 0, lowpassHz: null }

/** Zeroes every FFT bin above `cutoffHz` (and its mirror): an ideal low-pass over the whole clip. */
export function lowpass(x: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const n = nextPow2(x.length)
  const spec = realFft(x, n)
  const k0 = Math.ceil((cutoffHz / sampleRate) * n)
  for (let k = k0; k <= n - k0; k++) {
    spec.re[k] = 0
    spec.im[k] = 0
  }
  return inverseRealFft(spec, x.length)
}

/** Simulates transmission: low-pass (optional), volume change, AWGN, then 16-bit quantisation (with clipping). */
export function applyChannel(x: Float32Array, params: ChannelParams, sampleRate = SAMPLE_RATE): Float32Array {
  const g = 10 ** (params.gainDb / 20)
  const filtered = params.lowpassHz ? lowpass(x, sampleRate, params.lowpassHz) : x
  const out = filtered.map((v) => v * g)
  if (params.noiseSnrDb !== null) {
    const sigPow = energy(out) / out.length
    const noiseStd = Math.sqrt(sigPow / 10 ** (params.noiseSnrDb / 10))
    const noise = gaussianNoise(out.length, params.seed ?? 1234)
    for (let i = 0; i < out.length; i++) out[i] += noiseStd * noise[i]
  }
  if (params.quantize16) {
    for (let i = 0; i < out.length; i++) {
      const c = Math.max(-1, Math.min(1, out[i]))
      out[i] = Math.round(c * 32767) / 32767
    }
  }
  return out
}
