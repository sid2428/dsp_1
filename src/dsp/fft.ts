/**
 * Radix-2 FFT, implemented two ways:
 *  - DIT (decimation in time):      bit-reversed input  -> natural-order output
 *  - DIF (decimation in frequency): natural-order input -> bit-reversed output (re-ordered at the end)
 *
 * The same routine powers the real decoder AND the butterfly visualizer: the visualizer
 * passes an `onButterfly` hook and gets told about every butterfly the decoder would execute.
 */

export type FftKind = 'dit' | 'dif'

export interface ButterflyEvent {
  /** 0-based stage index (log2(N) stages in total). */
  stage: number
  /** Array position of the upper wing. */
  top: number
  /** Array position of the lower wing. */
  bottom: number
  /** Twiddle exponent k in W_N^k = e^{-j 2 pi k / N}. */
  k: number
}

export interface FftOptions {
  kind?: FftKind
  inverse?: boolean
  onButterfly?: (e: ButterflyEvent) => void
  /** Called after the initial re-ordering (DIT) / before the first stage (DIF) with stage = -1,
   *  after each stage with its index, and (DIF only) after the final re-ordering with stage = log2N. */
  onStage?: (stage: number, re: Float64Array, im: Float64Array) => void
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export function log2Int(n: number): number {
  return Math.round(Math.log2(n))
}

export function bitReverse(i: number, bits: number): number {
  let r = 0
  for (let b = 0; b < bits; b++) {
    r = (r << 1) | (i & 1)
    i >>= 1
  }
  return r
}

export function bitReversePermute(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
}

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>()

/** cos/sin of 2*pi*k/N for k < N/2, cached per N. */
function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = twiddleCache.get(n)
  if (!t) {
    const half = n >> 1
    const cos = new Float64Array(half)
    const sin = new Float64Array(half)
    for (let k = 0; k < half; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n)
      sin[k] = Math.sin((2 * Math.PI * k) / n)
    }
    t = { cos, sin }
    if (twiddleCache.size > 8) twiddleCache.clear()
    twiddleCache.set(n, t)
  }
  return t
}

/** In-place complex FFT. Forward uses W = e^{-j2pi k/N}; inverse conjugates W and divides by N. */
export function fft(re: Float64Array, im: Float64Array, opts: FftOptions = {}): void {
  const n = re.length
  if (im.length !== n) throw new Error('fft: re/im length mismatch')
  if (!isPowerOfTwo(n)) throw new Error(`fft: length ${n} is not a power of two`)
  const kind = opts.kind ?? 'dit'
  const sign = opts.inverse ? 1 : -1
  const { cos, sin } = twiddles(n)
  const hook = opts.onButterfly
  const stages = log2Int(n)

  if (kind === 'dit') {
    bitReversePermute(re, im)
    opts.onStage?.(-1, re, im)
    for (let size = 2, stage = 0; size <= n; size <<= 1, stage++) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step
          const wr = cos[k]
          const wi = sign * sin[k]
          const a = start + j
          const b = a + half
          // lower wing is multiplied by the twiddle BEFORE the add/subtract
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
          if (hook) hook({ stage, top: a, bottom: b, k })
        }
      }
      opts.onStage?.(stage, re, im)
    }
  } else {
    opts.onStage?.(-1, re, im)
    for (let size = n, stage = 0; size >= 2; size >>= 1, stage++) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let j = 0; j < half; j++) {
          const k = j * step
          const wr = cos[k]
          const wi = sign * sin[k]
          const a = start + j
          const b = a + half
          // lower wing is multiplied by the twiddle AFTER the subtract
          const ur = re[a] - re[b]
          const ui = im[a] - im[b]
          re[a] += re[b]
          im[a] += im[b]
          re[b] = ur * wr - ui * wi
          im[b] = ur * wi + ui * wr
          if (hook) hook({ stage, top: a, bottom: b, k })
        }
      }
      opts.onStage?.(stage, re, im)
    }
    bitReversePermute(re, im)
    opts.onStage?.(stages, re, im)
  }

  if (opts.inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

export interface Spectrum {
  re: Float64Array
  im: Float64Array
  n: number
}

/** FFT of a real signal zero-padded to `n` (power of two). */
export function realFft(x: ArrayLike<number>, n: number, kind: FftKind = 'dit'): Spectrum {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const len = Math.min(n, x.length)
  for (let i = 0; i < len; i++) re[i] = x[i]
  fft(re, im, { kind })
  return { re, im, n }
}

/** Inverse FFT keeping the real part; returns the first `length` samples. Input is not modified. */
export function inverseRealFft(spec: Spectrum, length: number, kind: FftKind = 'dit'): Float32Array {
  const re = Float64Array.from(spec.re)
  const im = Float64Array.from(spec.im)
  fft(re, im, { kind, inverse: true })
  const out = new Float32Array(length)
  const len = Math.min(length, spec.n)
  for (let i = 0; i < len; i++) out[i] = re[i]
  return out
}

/**
 * "Two-for-one" FFT: transforms two real signals with a single complex FFT of z = x + j·y, then
 * separates them using conjugate symmetry: X[k] = (Z[k] + Z*[N−k]) / 2, Y[k] = (Z[k] − Z*[N−k]) / 2j.
 */
export function fftTwoReal(x: ArrayLike<number>, y: ArrayLike<number>, n: number, kind: FftKind = 'dit'): [Spectrum, Spectrum] {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i]
  for (let i = 0; i < Math.min(n, y.length); i++) im[i] = y[i]
  fft(re, im, { kind })
  const X = { re: new Float64Array(n), im: new Float64Array(n), n }
  const Y = { re: new Float64Array(n), im: new Float64Array(n), n }
  for (let k = 0; k < n; k++) {
    const m = (n - k) % n
    const zr = re[k]
    const zi = im[k]
    const cr = re[m]
    const ci = -im[m] // conj(Z[N-k])
    X.re[k] = (zr + cr) / 2
    X.im[k] = (zi + ci) / 2
    // (Z - conj) / 2j  ->  multiply by -j/2
    Y.re[k] = (zi - ci) / 2
    Y.im[k] = -(zr - cr) / 2
  }
  return [X, Y]
}

/**
 * Inverse of several Hermitian spectra (real signals), two per complex IFFT:
 * IFFT(A + j·B) = a + j·b when a and b are real.
 */
export function inverseManyReal(specs: Spectrum[], length: number, kind: FftKind = 'dit'): Float32Array[] {
  const out: Float32Array[] = []
  for (let p = 0; p < specs.length; p += 2) {
    const A = specs[p]
    const B = specs[p + 1]
    if (!B) {
      out.push(inverseRealFft(A, length, kind))
      break
    }
    const n = A.n
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      re[k] = A.re[k] - B.im[k]
      im[k] = A.im[k] + B.re[k]
    }
    fft(re, im, { kind, inverse: true })
    const a = new Float32Array(length)
    const b = new Float32Array(length)
    for (let i = 0; i < Math.min(length, n); i++) {
      a[i] = re[i]
      b[i] = im[i]
    }
    out.push(a, b)
  }
  return out
}

/** Naive O(N^2) DFT, used only to verify the FFT in tests and in the visualizer. */
export function dft(re: ArrayLike<number>, im: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = re.length
  const oRe = new Float64Array(n)
  const oIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let sr = 0
    let si = 0
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n
      sr += re[t] * Math.cos(ang) - im[t] * Math.sin(ang)
      si += re[t] * Math.sin(ang) + im[t] * Math.cos(ang)
    }
    oRe[k] = sr
    oIm[k] = si
  }
  return { re: oRe, im: oIm }
}

export interface ButterflyTrace {
  n: number
  kind: FftKind
  /** Value of every array slot at each column: column 0 = input order the stages consume,
   *  column s+1 = after stage s. DIF additionally ends with the bit-reversal column. */
  columns: { re: number[]; im: number[] }[]
  /** Which original index sits at each slot of column 0 (bit-reversed for DIT). */
  inputOrder: number[]
  /** Which frequency index k sits at each slot of the last butterfly column. */
  outputOrder: number[]
  butterflies: ButterflyEvent[][]
}

/** Runs the real FFT on a short signal and records every stage + butterfly for visualization. */
export function traceFft(input: ArrayLike<number>, kind: FftKind): ButterflyTrace {
  const n = input.length
  if (!isPowerOfTwo(n) || n < 2) throw new Error('traceFft: length must be a power of two >= 2')
  const bits = log2Int(n)
  const re = Float64Array.from(input)
  const im = new Float64Array(n)
  const columns: ButterflyTrace['columns'] = []
  const butterflies: ButterflyEvent[][] = Array.from({ length: bits }, () => [])
  fft(re, im, {
    kind,
    onStage: (stage) => {
      if (stage >= bits) return // DIF final re-ordering is described by outputOrder instead
      columns.push({ re: Array.from(re), im: Array.from(im) })
    },
    onButterfly: (e) => butterflies[e.stage].push(e),
  })
  const natural = Array.from({ length: n }, (_, i) => i)
  const reversed = natural.map((i) => bitReverse(i, bits))
  return {
    n,
    kind,
    columns,
    inputOrder: kind === 'dit' ? reversed : natural,
    outputOrder: kind === 'dit' ? natural : reversed,
    butterflies,
  }
}
