import type { DiagramEdge, DiagramNode } from '../components/diagram/signal-diagram'
import { CHIPS_PER_BIT, NUM_SUBBANDS, SAMPLE_RATE } from '../dsp/constants'
import type { DecodeStageId } from '../dsp/stego'
import type { DecodeOutput, DecodeStep } from '../worker/protocol'

export const DECODER_NODES: DiagramNode[] = [
  { id: 'received', label: 'Received', sub: 'r[n]', col: 0, row: 0, kind: 'io' },
  { id: 'fft', label: 'FFT', sub: 'radix-2 DIT/DIF', col: 1, row: 0, span: 2, kind: 'fft' },
  { id: 'extract', label: 'Band-pass', sub: 'keep carrier', col: 2, row: 0 },
  { id: 'shift', label: 'Shift down', sub: '→ speech band', col: 3, row: 0 },
  { id: 'unpermute', label: 'Un-shuffle', sub: 'needs key', col: 4, row: 0 },
  { id: 'uninvert', label: 'Spectral inv.', sub: 'self-inverse', col: 5, row: 0 },
  { id: 'ifft', label: 'IFFT', sub: 'to time', col: 6, row: 0, kind: 'fft' },
  { id: 'unreverse', label: 'Time reversal', sub: 'y[L−1−n]', col: 7, row: 0 },
  { id: 'voice', label: 'Voice out', sub: 'recovered.wav', col: 8, row: 0, kind: 'io' },
  { id: 'lane', label: 'Lane bins', sub: 'keep text lane', col: 2, row: 1 },
  { id: 'despread', label: 'Despread', sub: `Σ chip·X ×${CHIPS_PER_BIT}`, col: 3, row: 1 },
  { id: 'sync', label: 'Sync header', sub: '0xA5/A6/A7 ‖ len', col: 4, row: 1 },
  { id: 'decrypt', label: 'AES-GCM', sub: 'decrypt + verify', col: 5, row: 1 },
  { id: 'message', label: 'Text out', sub: 'plaintext', col: 6, row: 1, kind: 'io' },
]

export const DECODER_EDGES: DiagramEdge[] = [
  { from: 'received', to: 'fft' },
  { from: 'fft', to: 'extract', fromRow: 0 },
  { from: 'extract', to: 'shift' },
  { from: 'shift', to: 'unpermute' },
  { from: 'unpermute', to: 'uninvert' },
  { from: 'uninvert', to: 'ifft' },
  { from: 'ifft', to: 'unreverse' },
  { from: 'unreverse', to: 'voice' },
  { from: 'fft', to: 'lane', fromRow: 1 },
  { from: 'lane', to: 'despread' },
  { from: 'despread', to: 'sync' },
  { from: 'sync', to: 'decrypt' },
  { from: 'decrypt', to: 'message' },
]

export const DECODER_NODE_STAGE: Record<string, DecodeStep | 'start'> = {
  received: 'start',
  fft: 'fft',
  extract: 'extract',
  shift: 'extract',
  unpermute: 'unscramble',
  uninvert: 'unscramble',
  lane: 'lane',
  despread: 'lane',
  sync: 'lane',
  ifft: 'ifft',
  unreverse: 'ifft',
  voice: 'ifft',
  decrypt: 'decrypt',
  message: 'decrypt',
}

export const DECODE_STEP_LABEL: Record<DecodeStep, string> = {
  fft: 'FFT of the received file',
  extract: 'Extract hidden bands',
  unscramble: 'Un-shuffle + inversion',
  lane: 'Despread text lane',
  ifft: 'Inverse FFTs',
  decrypt: 'Authenticate + decrypt',
  analysis: 'Spectra for display',
}
export const DECODE_STEP_ORDER: DecodeStep[] = ['fft', 'extract', 'unscramble', 'lane', 'ifft', 'decrypt', 'analysis']

export interface DecoderWalkStep {
  id: string
  nodes: string[]
  title: string
  body: string
  timing: DecodeStep | null
  stage?: DecodeStageId
  before?: DecodeStageId
  normalize?: boolean
  formula?: string
  zoom?: 'full' | 'speech' | 'hidden'
}

const khz = (hz: number) => `${(hz / 1000).toFixed(2)} kHz`
const int = (v: number) => v.toLocaleString('en-US')

export function decoderSteps(dec: DecodeOutput, kind: 'dit' | 'dif'): DecoderWalkStep[] {
  const L = dec.layout
  const len = dec.stages.received.samples.length
  const carrierLo = L.carrierLow * L.binHz
  const t = dec.text
  const statusLine =
    t.status === 'ok'
      ? `The tag verified, so the plaintext (${int(new TextEncoder().encode(t.text ?? '').length)} bytes) is shown.`
      : t.status === 'auth-failed'
        ? 'The tag did not verify: nothing is revealed.'
        : t.status === 'voice-verified'
          ? 'This is a voice frame: its payload is an AES-GCM key token with empty plaintext, and it verified.'
          : 'The header never synced, so no ciphertext was read.'
  return [
    {
      id: 'received',
      nodes: ['received'],
      title: 'The received file',
      body: `${int(len)} samples (${(len / SAMPLE_RATE).toFixed(2)} s). Only this audio and the key you typed are used from here on.`,
      timing: null,
      stage: 'received',
    },
    {
      id: 'fft',
      nodes: ['fft'],
      title: 'One FFT over the whole clip',
      body: `Zero-padded to N = 2^${dec.fftStages} = ${int(dec.fftSize)} and transformed with the same radix-2 ${kind.toUpperCase()} routine the encoder uses: ${int(dec.butterflyCount)} butterflies in ${dec.fftStages} stages, ${dec.fftMs.toFixed(1)} ms in this browser. The receiver derives N from the file length alone, so it lands on the sender's exact bin grid.`,
      timing: 'fft',
      stage: 'received',
      formula: 'X[k] = Σ r[n]·W_N^{nk}',
    },
    {
      id: 'extract',
      nodes: ['extract'],
      title: 'Keep only the voice carrier',
      body: `An ideal FFT band-pass keeps bins ${int(L.carrierLow)}–${int(L.carrierLow + L.width)} (${khz(carrierLo)}–${khz(carrierLo + L.width * L.binHz)}). That band holds ${dec.carrierLevelDb.toFixed(1)} dB of the file's energy${dec.carrierLevelDb < -70 ? ' — essentially empty' : ''}.`,
      timing: 'extract',
      stage: 'band-extracted',
      before: 'received',
      normalize: true,
      zoom: 'hidden',
      formula: 'B[k] = X[k]·rect(k ∈ carrier)',
    },
    {
      id: 'shift',
      nodes: ['shift'],
      title: 'Shift back to the speech band',
      body: `The same bins are moved down by ${khz(carrierLo - L.baseLow * L.binHz)}. It is still scrambled — listen, it does not sound like speech yet.`,
      timing: 'extract',
      stage: 'baseband',
      before: 'band-extracted',
      normalize: true,
      zoom: 'speech',
      formula: 'Y[k] = B[k + Δk]',
    },
    {
      id: 'unpermute',
      nodes: ['unpermute'],
      title: 'Undo the shuffle with your key',
      body: `Your key regenerates a permutation of the ${NUM_SUBBANDS} sub-bands, applied in reverse. If the key is wrong, this order is wrong and the speech stays unintelligible.`,
      timing: 'unscramble',
      stage: 'depermuted',
      before: 'baseband',
      normalize: true,
      zoom: 'speech',
      formula: 'Y_{π_key(i)} = B_i',
    },
    {
      id: 'uninvert',
      nodes: ['uninvert', 'ifft'],
      title: 'Undo the inversion, return to time',
      body: 'Spectral inversion is its own inverse, so applying it again restores the band; an inverse FFT gives a time signal — the voice, still backwards.',
      timing: 'unscramble',
      stage: 'deinverted',
      before: 'depermuted',
      normalize: true,
      zoom: 'speech',
      formula: 'Y[k] = B*[k_lo + k_hi − k]',
    },
    {
      id: 'unreverse',
      nodes: ['unreverse', 'voice'],
      title: 'Play it forwards',
      body: 'Reversing time once more reveals the voice, normalised to a 0.9 peak for listening.',
      timing: 'ifft',
      stage: 'recovered',
      before: 'deinverted',
      normalize: true,
      zoom: 'speech',
      formula: 'x[n] = y[L−1−n]',
    },
    {
      id: 'lane',
      nodes: ['lane'],
      title: 'Read the text lane',
      body: `The same FFT also holds the text lane at ${khz(dec.laneLowHz)}–${khz(dec.laneHighHz)}. Its bins are read directly; nothing else is needed.`,
      timing: 'lane',
      stage: 'text-lane',
      before: 'received',
      normalize: true,
      zoom: 'hidden',
    },
    {
      id: 'despread',
      nodes: ['despread', 'sync'],
      title: 'Despread and find the header',
      body: `Every ${CHIPS_PER_BIT} bins are multiplied by your key's ±1 chips and summed (12 dB processing gain); the sign is the bit. The first 24 bits must be a valid sync byte and length: here magic and length were read as ${t.status === 'no-payload' ? 'invalid — no sync' : `valid, payload ${int(t.headerLength)} bytes`}.`,
      timing: 'lane',
      formula: 'b̂ᵢ = [ Re Σ_c chip_{16i+c}·X[k₀+16i+c] < 0 ]',
    },
    {
      id: 'decrypt',
      nodes: ['decrypt', 'message'],
      title: 'Authenticate, then decrypt',
      body: `PBKDF2 re-derives the AES key from your key and the transmitted salt; AES-GCM checks the 16-byte tag before releasing anything. ${statusLine}`,
      timing: 'decrypt',
      formula: 'text = AES-GCM⁻¹_K(ct)  iff  tag ✓',
    },
  ]
}
