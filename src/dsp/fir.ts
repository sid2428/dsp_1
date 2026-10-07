import { fft, nextPow2 } from './fft'

export type WindowKind = 'hamming' | 'hann' | 'blackman' | 'rectangular'

export function windowValue(kind: WindowKind, n: number, length: number): number {
  if (length === 1) return 1
  const x = (2 * Math.PI * n) / (length - 1)
  switch (kind) {
    case 'hamming':
      return 0.54 - 0.46 * Math.cos(x)
    case 'hann':
      return 0.5 - 0.5 * Math.cos(x)
    case 'blackman':
      return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x)
    case 'rectangular':
      return 1
  }
}

function sinc(x: number): number {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

/**
 * Windowed-sinc linear-phase FIR band-pass (type I, odd length).
 * h[n] = w[n] * (2 f2 sinc(2 f2 (n-M)) - 2 f1 sinc(2 f1 (n-M))), f normalised to sample rate,
 * scaled for unity gain at the centre of the pass band.
 */
export function designBandpass(
  numTaps: number,
  lowHz: number,
  highHz: number,
  sampleRate: number,
  window: WindowKind = 'hamming',
): Float64Array {
  if (numTaps % 2 === 0) throw new Error('designBandpass: numTaps must be odd')
  if (!(lowHz > 0 && highHz > lowHz && highHz < sampleRate / 2)) {
    throw new Error('designBandpass: need 0 < low < high < Nyquist')
  }
  const f1 = lowHz / sampleRate
  const f2 = highHz / sampleRate
  const m = (numTaps - 1) / 2
  const h = new Float64Array(numTaps)
  for (let n = 0; n < numTaps; n++) {
    const t = n - m
    h[n] = (2 * f2 * sinc(2 * f2 * t) - 2 * f1 * sinc(2 * f1 * t)) * windowValue(window, n, numTaps)
  }
  // normalise |H| = 1 at the band centre
  const fc = (f1 + f2) / 2
  let gr = 0
  let gi = 0
  for (let n = 0; n < numTaps; n++) {
    gr += h[n] * Math.cos(2 * Math.PI * fc * n)
    gi -= h[n] * Math.sin(2 * Math.PI * fc * n)
  }
  const g = Math.hypot(gr, gi)
  for (let n = 0; n < numTaps; n++) h[n] /= g
  return h
}

export interface FrequencyResponse {
  freqs: Float32Array
  magDb: Float32Array
}

/** |H(e^{jw})| in dB on `points` evenly spaced frequencies from 0 to Nyquist. */
export function frequencyResponse(h: Float64Array, sampleRate: number, points = 512): FrequencyResponse {
  const freqs = new Float32Array(points)
  const magDb = new Float32Array(points)
  for (let p = 0; p < points; p++) {
    const f = (p / (points - 1)) * 0.5
    let re = 0
    let im = 0
    for (let n = 0; n < h.length; n++) {
      re += h[n] * Math.cos(2 * Math.PI * f * n)
      im -= h[n] * Math.sin(2 * Math.PI * f * n)
    }
    freqs[p] = f * sampleRate
    magDb[p] = 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-10))
  }
  return { freqs, magDb }
}

/**
 * Fast convolution via FFT (Y = X . H), returning the 'same'-length output with the
 * FIR's (numTaps-1)/2 group delay removed so the output lines up with the input.
 */
export function fftConvolveSame(x: Float32Array, h: Float64Array): Float32Array {
  const n = nextPow2(x.length + h.length - 1)
  const xr = new Float64Array(n)
  const xi = new Float64Array(n)
  const hr = new Float64Array(n)
  const hi = new Float64Array(n)
  for (let i = 0; i < x.length; i++) xr[i] = x[i]
  for (let i = 0; i < h.length; i++) hr[i] = h[i]
  fft(xr, xi)
  fft(hr, hi)
  for (let k = 0; k < n; k++) {
    const r = xr[k] * hr[k] - xi[k] * hi[k]
    const i = xr[k] * hi[k] + xi[k] * hr[k]
    xr[k] = r
    xi[k] = i
  }
  fft(xr, xi, { inverse: true })
  const delay = (h.length - 1) / 2
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = xr[i + delay]
  return out
}
