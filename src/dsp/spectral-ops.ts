import type { Spectrum } from './fft'
import { CARRIER_LOW_HZ, GUARD_HZ, NUM_SUBBANDS, SECRET_HIGH_HZ, SECRET_LOW_HZ } from './constants'

/** Bin positions used by both sender and receiver for an N-point FFT. */
export interface BandLayout {
  n: number
  sampleRate: number
  binHz: number
  /** First bin of the transmitted band (speech band minus guard, 150 Hz). */
  baseLow: number
  /** Width of the band in bins (a multiple of `subbands`). */
  width: number
  /** First bin of the carrier band (16.5 kHz). */
  carrierLow: number
  subbands: number
  subbandWidth: number
}

export function computeLayout(n: number, sampleRate: number): BandLayout {
  const binHz = sampleRate / n
  const baseLow = Math.round((SECRET_LOW_HZ - GUARD_HZ) / binHz)
  const rawWidth = Math.round((SECRET_HIGH_HZ + GUARD_HZ) / binHz) - baseLow
  const subbandWidth = Math.floor(rawWidth / NUM_SUBBANDS)
  if (subbandWidth < 1) throw new Error('Audio is too short to hold the secret band')
  const width = subbandWidth * NUM_SUBBANDS
  const carrierLow = Math.round(CARRIER_LOW_HZ / binHz)
  if (carrierLow + width >= n / 2) {
    throw new Error(`Carrier band exceeds Nyquist (sample rate ${sampleRate} Hz is too low)`)
  }
  return { n, sampleRate, binHz, baseLow, width, carrierLow, subbands: NUM_SUBBANDS, subbandWidth }
}

/** A contiguous run of positive-frequency bins. */
export interface Band {
  re: Float64Array
  im: Float64Array
}

export function emptySpectrum(n: number): Spectrum {
  return { re: new Float64Array(n), im: new Float64Array(n), n }
}

export function cloneSpectrum(s: Spectrum): Spectrum {
  return { re: Float64Array.from(s.re), im: Float64Array.from(s.im), n: s.n }
}

export function takeBand(spec: Spectrum, start: number, width: number): Band {
  return {
    re: spec.re.slice(start, start + width),
    im: spec.im.slice(start, start + width),
  }
}

/**
 * Adds a band at `start` and its complex-conjugate mirror at N-k (Hermitian symmetry),
 * so the inverse FFT stays a real, playable signal.
 */
export function addBand(spec: Spectrum, start: number, band: Band): void {
  const { n } = spec
  for (let i = 0; i < band.re.length; i++) {
    const k = start + i
    spec.re[k] += band.re[i]
    spec.im[k] += band.im[i]
    spec.re[n - k] += band.re[i]
    spec.im[n - k] -= band.im[i]
  }
}

export function spectrumWithBand(n: number, start: number, band: Band): Spectrum {
  const s = emptySpectrum(n)
  addBand(s, start, band)
  return s
}

/** Zeroes a band and its mirror (an ideal FFT-domain band-stop). */
export function clearBand(spec: Spectrum, start: number, width: number): void {
  const { n } = spec
  for (let k = start; k < start + width; k++) {
    spec.re[k] = 0
    spec.im[k] = 0
    spec.re[n - k] = 0
    spec.im[n - k] = 0
  }
}

/**
 * Spectral inversion: frequency f inside [lo, hi] maps to lo + hi - f.
 * Equivalent to modulating by cos(2 pi (lo+hi) t) and keeping the lower sideband, which
 * reverses the bin order and conjugates each bin. Applying it twice gives the original back.
 */
export function invertBand(band: Band): Band {
  const w = band.re.length
  const re = new Float64Array(w)
  const im = new Float64Array(w)
  for (let i = 0; i < w; i++) {
    re[i] = band.re[w - 1 - i]
    im[i] = -band.im[w - 1 - i]
  }
  return { re, im }
}

/** Output sub-band i takes input sub-band perm[i]. */
export function permuteBand(band: Band, perm: readonly number[], subbandWidth: number): Band {
  const re = new Float64Array(band.re.length)
  const im = new Float64Array(band.im.length)
  perm.forEach((src, dst) => {
    re.set(band.re.subarray(src * subbandWidth, (src + 1) * subbandWidth), dst * subbandWidth)
    im.set(band.im.subarray(src * subbandWidth, (src + 1) * subbandWidth), dst * subbandWidth)
  })
  return { re, im }
}

/** Undo permuteBand: input sub-band i goes back to slot perm[i]. */
export function unpermuteBand(band: Band, perm: readonly number[], subbandWidth: number): Band {
  const re = new Float64Array(band.re.length)
  const im = new Float64Array(band.im.length)
  perm.forEach((src, dst) => {
    re.set(band.re.subarray(dst * subbandWidth, (dst + 1) * subbandWidth), src * subbandWidth)
    im.set(band.im.subarray(dst * subbandWidth, (dst + 1) * subbandWidth), src * subbandWidth)
  })
  return { re, im }
}

export function scaleBand(band: Band, gain: number): Band {
  return { re: band.re.map((v) => v * gain), im: band.im.map((v) => v * gain) }
}

/** Time-domain energy (sum of x^2) of the real signal this one-sided band represents (Parseval). */
export function bandEnergy(band: Band, n: number): number {
  let e = 0
  for (let i = 0; i < band.re.length; i++) e += band.re[i] * band.re[i] + band.im[i] * band.im[i]
  return (2 * e) / n
}
