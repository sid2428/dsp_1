import type { DiagramEdge, DiagramNode } from '../components/diagram/signal-diagram'
import { CHIPS_PER_BIT, FIR_TAPS, LANE_STRENGTH_DB, NUM_SUBBANDS, SAMPLE_RATE, SECRET_HIGH_HZ, SECRET_LOW_HZ } from '../dsp/constants'
import type { EncodeStageId } from '../dsp/stego'
import type { EncodeOutput, EncodeStep } from '../worker/protocol'

/** The encoder as `encode()` really runs it: one shared FFT first, then every operation on FFT bins. */
export const ENCODER_NODES: DiagramNode[] = [
  { id: 'voice', label: 'Voice in', sub: 'x_v[n]', col: 0, row: 0, kind: 'io' },
  { id: 'cover', label: 'Cover in', sub: 'x_c[n]', col: 0, row: 1, kind: 'io' },
  { id: 'text', label: 'Text in', sub: 'UTF-8', col: 0, row: 2, kind: 'io' },
  { id: 'fft', label: 'FFT ×2', sub: 'two-for-one', col: 1, row: 0, span: 2, kind: 'fft' },
  { id: 'fir', label: 'FIR band-pass', sub: 'X·H[k]', col: 2, row: 0 },
  { id: 'reverse', label: 'Time reversal', sub: 'X*[k]·e^−jθk', col: 3, row: 0 },
  { id: 'invert', label: 'Spectral inv.', sub: 'f → lo+hi−f', col: 4, row: 0 },
  { id: 'permute', label: 'Keyed shuffle', sub: `${NUM_SUBBANDS} sub-bands`, col: 5, row: 0 },
  { id: 'shift', label: 'Gain + shift', sub: '→ 16.5 kHz', col: 6, row: 0 },
  { id: 'bandstop', label: 'Band-stop', sub: 'zero 2 bands', col: 3, row: 1 },
  { id: 'aes', label: 'AES-256-GCM', sub: 'PBKDF2 key', col: 1, row: 2 },
  { id: 'frame', label: 'Frame', sub: 'sync ‖ len ‖ ct', col: 2, row: 2 },
  { id: 'spread', label: 'BPSK spread', sub: `×${CHIPS_PER_BIT} chips`, col: 3, row: 2 },
  { id: 'mix', label: 'Σ  sum', sub: 'spectra', col: 6, row: 1, kind: 'sum' },
  { id: 'ifft', label: 'IFFT + limit', sub: 'real output', col: 7, row: 1, kind: 'fft' },
  { id: 'stego', label: 'Stego out', sub: 'stego.wav', col: 8, row: 1, kind: 'io' },
]

export const ENCODER_EDGES: DiagramEdge[] = [
  { from: 'voice', to: 'fft', toRow: 0 },
  { from: 'cover', to: 'fft', toRow: 1 },
  { from: 'fft', to: 'fir', fromRow: 0 },
  { from: 'fft', to: 'bandstop', fromRow: 1 },
  { from: 'fir', to: 'reverse' },
  { from: 'reverse', to: 'invert' },
  { from: 'invert', to: 'permute' },
  { from: 'permute', to: 'shift' },
  { from: 'shift', to: 'mix', enter: 'top' },
  { from: 'bandstop', to: 'mix' },
  { from: 'text', to: 'aes' },
  { from: 'aes', to: 'frame' },
  { from: 'frame', to: 'spread' },
  { from: 'spread', to: 'mix', enter: 'bottom' },
  { from: 'mix', to: 'ifft' },
  { from: 'ifft', to: 'stego' },
]

/** Which worker progress stage completes each block. */
export const ENCODER_NODE_STAGE: Record<string, EncodeStep | 'start'> = {
  voice: 'start',
  cover: 'start',
  text: 'start',
  aes: 'aes',
  frame: 'aes',
  fft: 'fft',
  fir: 'fir',
  reverse: 'reverse',
  invert: 'scramble',
  permute: 'scramble',
  bandstop: 'embed',
  shift: 'embed',
  mix: 'embed',
  spread: 'lane',
  ifft: 'ifft',
  stego: 'ifft',
}

/** Human names for the progress log, in execution order. */
export const ENCODE_STEP_LABEL: Record<EncodeStep, string> = {
  aes: 'Encrypt + frame text',
  fft: 'FFT (voice + cover)',
  fir: 'FIR band-pass',
  reverse: 'Time reversal',
  scramble: 'Inversion + shuffle',
  embed: 'Band-stop + embed',
  lane: 'Spread text lane',
  ifft: 'Inverse FFT',
  analysis: 'Spectra for display',
}
export const ENCODE_STEP_ORDER: EncodeStep[] = ['aes', 'fft', 'fir', 'reverse', 'scramble', 'embed', 'lane', 'ifft', 'analysis']

export interface EncoderWalkStep {
  id: string
  nodes: string[]
  title: string
  body: string
  timing: EncodeStep | null
  stage?: EncodeStageId
  before?: EncodeStageId
  /** Loudness-normalise playback (internal signals are very quiet). */
  normalize?: boolean
  formula?: string
}

const khz = (hz: number, d = 2) => `${(hz / 1000).toFixed(d)} kHz`
const int = (v: number) => v.toLocaleString('en-US')

/** The walkthrough for one finished encode, with every number taken from that result. */
export function encoderSteps(enc: EncodeOutput): EncoderWalkStep[] {
  const { layout: L, text } = enc
  const n = L.n
  const len = enc.stages.cover.samples.length
  const speechLo = L.baseLow * L.binHz
  const speechHi = (L.baseLow + L.width) * L.binHz
  const carrierLo = L.carrierLow * L.binHz
  const gainDb = enc.gain > 0 ? 20 * Math.log10(enc.gain) : -Infinity
  const voice = enc.hasVoice
  const hasText = !!text && text.content !== 'voice'
  const steps: EncoderWalkStep[] = []

  steps.push({
    id: 'inputs',
    nodes: ['voice', 'cover', 'text'],
    title: 'Inputs enter the encoder',
    body: `The cover has ${int(len)} samples (${(len / SAMPLE_RATE).toFixed(2)} s at 44.1 kHz mono). ${
      voice ? `The voice is fitted to the same length${enc.secretTruncated ? ' (trimmed, it was longer)' : ''}.` : 'No voice was supplied, so the voice path carries zeros.'
    } ${hasText ? `The text is ${int(new TextEncoder().encode(text.plaintext).length)} UTF-8 bytes.` : 'No text was supplied.'}`,
    timing: null,
    stage: 'cover',
  })

  if (text) {
    steps.push({
      id: 'aes',
      nodes: ['aes', 'frame'],
      title: hasText ? 'Encrypt the text and frame it' : 'Make the key-verification token',
      body: hasText
        ? `PBKDF2-SHA256 (100 000 rounds, random salt) turns the key into an AES-256 key; GCM encrypts and appends a 16-byte tag. A sync byte 0x${text.content === 'text' ? 'A6' : 'A5'} and a 16-bit length go in front: ${int(text.bits.length)} bits in total. The sync byte also tells the receiver ${text.content === 'text' ? 'that no voice was sent' : 'that a voice was sent too'}.`
        : `Voice payload: AES-256-GCM encrypts an empty plaintext, giving a ${text.cipher.length}-byte token (salt, IV, tag). Framed behind sync byte 0xA7, it lets the receiver authenticate the key; the voice audio itself cannot be authenticated.`,
      timing: 'aes',
      formula: hasText ? 'frame = 0xA5|A6 ‖ len ‖ salt ‖ IV ‖ AES-GCM_K(text) ‖ tag' : 'frame = 0xA7 ‖ len ‖ salt ‖ IV ‖ AES-GCM_K(∅) ‖ tag',
    })
  }

  steps.push({
    id: 'fft',
    nodes: ['fft'],
    title: 'One FFT for two signals',
    body: `Voice and cover are zero-padded to N = 2^${Math.log2(n)} = ${int(n)} points (room for the ${FIR_TAPS}-tap filter without wrap-around) and packed as z = voice + j·cover, so one complex radix-2 FFT yields both spectra. Bin spacing is ${L.binHz.toFixed(4)} Hz.`,
    timing: 'fft',
    stage: voice ? 'secret' : 'cover',
    normalize: voice,
    formula: 'X[k] = ½(Z[k] + Z*[N−k]),  C[k] = (Z[k] − Z*[N−k]) / 2j',
  })

  if (voice) {
    steps.push(
      {
        id: 'fir',
        nodes: ['fir'],
        title: 'Band-limit the voice',
        body: `A ${FIR_TAPS}-tap Hamming windowed-sinc band-pass (${SECRET_LOW_HZ}–${SECRET_HIGH_HZ} Hz) is applied by multiplying spectra, then its ${(FIR_TAPS - 1) / 2}-sample group delay is removed with a linear phase term. Only telephone-band speech remains.`,
        timing: 'fir',
        stage: 'secret-bandlimited',
        before: 'secret',
        normalize: true,
        formula: 'Y[k] = X[k]·H[k]·e^{+j2πk·511/N}',
      },
      {
        id: 'reverse',
        nodes: ['reverse'],
        title: 'Reverse time, in the frequency domain',
        body: `Playing the voice backwards is done without leaving the FFT: conjugate every bin and apply a linear phase of ${int(len - 1)} samples. Magnitudes are unchanged; speech becomes unintelligible.`,
        timing: 'reverse',
        stage: 'secret-reversed',
        before: 'secret-bandlimited',
        normalize: true,
        formula: 'x[L−1−n]  ⟷  X*[k]·e^{−j2πk(L−1)/N}',
      },
      {
        id: 'invert',
        nodes: ['invert'],
        title: 'Spectral inversion',
        body: `Inside ${khz(speechLo)}–${khz(speechHi)} (${int(L.width)} bins) the bin order is reversed and conjugated, so low frequencies become high — the classic analogue voice scrambler.`,
        timing: 'scramble',
        stage: 'secret-inverted',
        before: 'secret-reversed',
        normalize: true,
        formula: 'Y[k] = X*[k_lo + k_hi − k]',
      },
      {
        id: 'permute',
        nodes: ['permute'],
        title: 'Shuffle sub-bands with the key',
        body: `The band is cut into ${NUM_SUBBANDS} sub-bands of ${int(L.subbandWidth)} bins. A Fisher–Yates permutation seeded from the key moves every one of them: [${enc.permutation.join(', ')}].`,
        timing: 'scramble',
        stage: 'secret-permuted',
        before: 'secret-inverted',
        normalize: true,
        formula: 'Y_i = X_{π_key(i)},  i = 0…15',
      },
    )
  }

  steps.push({
    id: 'bandstop',
    nodes: ['bandstop'],
    title: 'Clear room in the cover',
    body: `The cover's bins in the voice carrier (${khz(carrierLo)}–${khz(carrierLo + L.width * L.binHz)}) and the text lane${text ? ` (${khz(text.laneLowHz)}–${khz(text.laneHighHz)})` : ''} are set to zero, together with their mirror bins, so nothing of the cover collides with the message.`,
    timing: 'embed',
    stage: 'cover-cleared',
    before: 'cover',
    formula: 'C[k] = C[N−k] = 0,  k ∈ carrier ∪ lane',
  })

  if (voice) {
    steps.push({
      id: 'shift',
      nodes: ['shift', 'mix'],
      title: 'Scale, move up and add',
      body: `The scrambled band is scaled by g = ${enc.gain.toExponential(2)} (${gainDb.toFixed(1)} dB) so it sits 20 dB below the cover's energy, moved ${khz(carrierLo - speechLo)} up to start at ${khz(carrierLo)}, and mirrored to bin N−k so the result stays real.`,
      timing: 'embed',
      stage: 'secret-shifted',
      before: 'secret-permuted',
      normalize: true,
      formula: 'S[k + Δk] = g·Y[k],  S[N−k] = S*[k]',
    })
  }

  if (text) {
    steps.push({
      id: 'spread',
      nodes: ['spread', 'mix'],
      title: 'Phase-code the bits',
      body: `Each of the ${int(text.bits.length)} bits becomes ${CHIPS_PER_BIT} real FFT bins of ±A (BPSK), multiplied by a key-seeded ±1 chip sequence: ${int(text.usedBins)} of the lane's ${int(text.laneBins)} bins, ${LANE_STRENGTH_DB} dB below the cover. Despreading gains 12 dB at the receiver.`,
      timing: 'lane',
      stage: 'text-lane',
      normalize: true,
      formula: 'X[k₀+16i+c] = A·(−1)^{bᵢ}·chip_{16i+c}',
    })
  }

  steps.push({
    id: 'ifft',
    nodes: ['ifft', 'stego'],
    title: 'Back to audio',
    body: `The summed spectrum goes through the inverse FFT and is cut back to ${int(len)} samples. ${
      enc.clipScale < 1 ? `Its peak exceeded 0.99, so the whole file was scaled by ${enc.clipScale.toFixed(3)} (${(20 * Math.log10(enc.clipScale)).toFixed(2)} dB) to avoid clipping.` : 'The peak stayed below 0.99, so no limiting was needed.'
    } This is the file that is sent.`,
    timing: 'ifft',
    stage: 'stego',
    before: 'cover',
    formula: 's[n] = IFFT{ C[k] + S[k] + T[k] }',
  })

  return steps
}
