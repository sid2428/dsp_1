import { fft } from './fft'
import { windowValue } from './fir'

export function energy(x: ArrayLike<number>): number {
  let e = 0
  for (let i = 0; i < x.length; i++) e += x[i] * x[i]
  return e
}

export function peak(x: ArrayLike<number>): number {
  let p = 0
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i])
    if (a > p) p = a
  }
  return p
}

export function reverse(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[x.length - 1 - i]
  return out
}

/** Scales so the peak equals `target` (no-op for silence). */
export function normalizePeak(x: Float32Array, target = 0.9): Float32Array {
  const p = peak(x)
  if (p === 0) return Float32Array.from(x)
  const g = target / p
  return x.map((v) => v * g)
}

function overlap(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.min(a.length, b.length)
}

/** Plain SNR of `test` against `ref`, in dB. */
export function snrDb(ref: ArrayLike<number>, test: ArrayLike<number>): number {
  const len = overlap(ref, test)
  let s = 0
  let e = 0
  for (let i = 0; i < len; i++) {
    s += ref[i] * ref[i]
    const d = ref[i] - test[i]
    e += d * d
  }
  if (e === 0) return Infinity
  return 10 * Math.log10(s / e)
}

/** Least-squares gain a so that a*test best matches ref (removes pure volume differences). */
export function matchedGain(ref: ArrayLike<number>, test: ArrayLike<number>): number {
  const len = overlap(ref, test)
  let num = 0
  let den = 0
  for (let i = 0; i < len; i++) {
    num += ref[i] * test[i]
    den += test[i] * test[i]
  }
  return den === 0 ? 0 : num / den
}

export function gainMatchedSnrDb(ref: ArrayLike<number>, test: ArrayLike<number>): number {
  const a = matchedGain(ref, test)
  const len = overlap(ref, test)
  const scaled = new Float32Array(len)
  for (let i = 0; i < len; i++) scaled[i] = a * test[i]
  return snrDb(ref, scaled)
}

/** Pearson correlation coefficient. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = overlap(a, b)
  let ma = 0
  let mb = 0
  for (let i = 0; i < len; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= len
  mb /= len
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < len; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    sab += da * db
    saa += da * da
    sbb += db * db
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb)
}

/**
 * Segmental SNR: mean per-frame SNR (clamped to [-10, 35] dB) over non-silent frames,
 * after a global gain match. Tracks perceived speech quality better than plain SNR.
 */
export function segmentalSnrDb(ref: ArrayLike<number>, test: ArrayLike<number>, frame = 1024): number {
  const a = matchedGain(ref, test)
  const len = overlap(ref, test)
  const frames: { s: number; e: number }[] = []
  let maxS = 0
  for (let start = 0; start + frame <= len; start += frame) {
    let s = 0
    let e = 0
    for (let i = start; i < start + frame; i++) {
      s += ref[i] * ref[i]
      const d = ref[i] - a * test[i]
      e += d * d
    }
    frames.push({ s, e })
    if (s > maxS) maxS = s
  }
  const active = frames.filter((f) => f.s > maxS * 1e-4)
  if (active.length === 0) return 0
  const sum = active.reduce((acc, f) => {
    const v = f.e === 0 ? 35 : 10 * Math.log10(f.s / f.e)
    return acc + Math.min(35, Math.max(-10, v))
  }, 0)
  return sum / active.length
}

export interface Psd {
  freqs: Float32Array
  db: Float32Array
}

/**
 * Welch power spectral density estimate (Hann window), in dB. `overlap` is the fraction of each frame
 * shared with the next; at most `maxFrames` frames, spread evenly over the signal, are averaged.
 */
export function welchPsd(x: Float32Array, sampleRate: number, nfft = 2048, overlap = 0.5, maxFrames = Infinity): Psd {
  const baseHop = Math.max(1, Math.round(nfft * (1 - overlap)))
  const available = Math.max(1, Math.floor((Math.max(x.length, nfft) - nfft) / baseHop) + 1)
  const hop = available > maxFrames ? Math.floor((Math.max(x.length, nfft) - nfft) / (maxFrames - 1)) || baseHop : baseHop
  const bins = nfft / 2 + 1
  const acc = new Float64Array(bins)
  const win = new Float64Array(nfft)
  let wPow = 0
  for (let i = 0; i < nfft; i++) {
    win[i] = windowValue('hann', i, nfft)
    wPow += win[i] * win[i]
  }
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  let count = 0
  for (let start = 0; start + nfft <= Math.max(x.length, nfft); start += hop) {
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[start + i] ?? 0) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    count++
  }
  const freqs = new Float32Array(bins)
  const db = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * sampleRate) / nfft
    db[k] = 10 * Math.log10(Math.max(acc[k] / (count * wPow), 1e-14))
  }
  return { freqs, db }
}

export interface Spectrogram {
  /** Column-major dB values: db[col * bins + bin]. */
  db: Float32Array
  cols: number
  bins: number
  duration: number
  sampleRate: number
}

/** Short-time FFT magnitude (dB) with a fixed number of columns for display. */
export function spectrogram(x: Float32Array, sampleRate: number, nfft = 1024, cols = 360): Spectrogram {
  const bins = nfft / 2
  const db = new Float32Array(cols * bins)
  const win = new Float64Array(nfft)
  for (let i = 0; i < nfft; i++) win[i] = windowValue('hann', i, nfft)
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  const span = Math.max(1, x.length - nfft)
  for (let c = 0; c < cols; c++) {
    const start = Math.floor((c / Math.max(1, cols - 1)) * span)
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[start + i] ?? 0) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) {
      db[c * bins + k] = 10 * Math.log10(Math.max(re[k] * re[k] + im[k] * im[k], 1e-12))
    }
  }
  return { db, cols, bins, duration: x.length / sampleRate, sampleRate }
}
