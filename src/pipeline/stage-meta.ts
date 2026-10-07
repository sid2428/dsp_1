import type { DecodeStageId, EncodeStageId } from '../dsp/stego'

export type NodeKind = 'input' | 'op' | 'fft' | 'mix' | 'output'

export interface PipelineNode<S extends string> {
  id: string
  title: string
  subtitle: string
  kind: NodeKind
  /** Which stage's audio is shown when this block is clicked (none for pure data blocks). */
  stage?: S
  /** Stage to compare against ("before" this block). */
  before?: S
  x: number
  y: number
  /** Order in which blocks light up during the animation. */
  order: number
  theory: string
  formula?: string
  /** Normalise loudness for listening (internal signals are very quiet). */
  normalize?: boolean
}

export interface PipelineEdge {
  from: string
  to: string
  /** Which side of the blocks the wire leaves / enters (default right → left). */
  fromSide?: 'right' | 'bottom'
  toSide?: 'left' | 'top'
}

const COL = 200
const ROW = 130

export const ENCODE_NODES: PipelineNode<EncodeStageId>[] = [
  {
    id: 'secret', title: 'Secret voice', subtitle: 'x_s[n]', kind: 'input', stage: 'secret', x: 0, y: 0, order: 0,
    theory: 'The message to hide: a speech clip, resampled to 44.1 kHz mono and trimmed/padded to the cover length.',
    normalize: true,
  },
  {
    id: 'fir', title: 'FIR band-pass', subtitle: '300 – 3400 Hz', kind: 'op', stage: 'secret-bandlimited', before: 'secret', x: COL * 1, y: 0, order: 1,
    theory: 'A 1023-tap linear-phase windowed-sinc (Hamming) band-pass keeps only telephone-quality speech, so it fits inside a narrow carrier band. Applied by fast convolution (FFT multiply).',
    formula: 'h[n] = w[n]·(2f₂·sinc(2f₂(n−M)) − 2f₁·sinc(2f₁(n−M)))',
    normalize: true,
  },
  {
    id: 'reverse', title: 'Time reversal', subtitle: 'x[−n]', kind: 'op', stage: 'secret-reversed', before: 'secret-bandlimited', x: COL * 2, y: 0, order: 2,
    theory: 'The voice is played backwards. For a real signal, reversing time conjugates the spectrum: magnitude is unchanged, phase is negated. Reversed speech is unintelligible but still speech-like — the first scrambling layer.',
    formula: 'x[−n]  ⟷  X*(e^{jω})',
    normalize: true,
  },
  {
    id: 'fft-secret', title: 'FFT', subtitle: 'radix-2, N = 2^m', kind: 'fft', stage: 'secret-reversed', x: COL * 3, y: 0, order: 3,
    theory: 'The whole clip is zero-padded to a power of two and transformed with the same radix-2 FFT the receiver uses. From here on, every operation is a manipulation of FFT bins.',
    formula: 'X[k] = Σ x[n]·W_N^{nk},  W_N = e^{−j2π/N}',
    normalize: true,
  },
  {
    id: 'invert', title: 'Spectral inversion', subtitle: 'f → f_lo + f_hi − f', kind: 'op', stage: 'secret-inverted', before: 'secret-reversed', x: COL * 4, y: 0, order: 4,
    theory: 'Low frequencies become high and vice versa inside the speech band — the classic analog voice scrambler. Equivalent to multiplying by cos(2π(f_lo+f_hi)t) and keeping the lower sideband: bins are reversed and conjugated.',
    formula: 'Y[k] = X*[k_lo + k_hi − k]',
    normalize: true,
  },
  {
    id: 'permute', title: 'Keyed permutation', subtitle: '16 sub-bands shuffled', kind: 'op', stage: 'secret-permuted', before: 'secret-inverted', x: COL * 5, y: 0, order: 5,
    theory: 'The band is cut into 16 equal sub-bands which are shuffled by a permutation derived from the secret key (hash → PRNG → Fisher–Yates). Without the key there are 16! ≈ 2×10¹³ possible orders.',
    formula: 'Y_i = X_{π_key(i)},  i = 0…15',
    normalize: true,
  },
  {
    id: 'shift', title: 'Shift up', subtitle: '→ 16.5 – 19.9 kHz', kind: 'op', stage: 'secret-shifted', before: 'secret-permuted', x: COL * 6, y: 0, order: 6,
    theory: 'The scrambled band is moved to the top of the audible range, where human hearing is weakest, and scaled to sit the chosen number of dB below the cover. This is single-sideband modulation done by moving bins (with Hermitian mirroring so the signal stays real).',
    formula: 'Y[k + Δk] = g·X[k],  Y[N−k] = Y*[k]',
    normalize: true,
  },
  {
    id: 'cover', title: 'Cover music', subtitle: 'x_c[n]', kind: 'input', stage: 'cover', x: COL * 3, y: ROW, order: 0,
    theory: 'The innocent-looking carrier track that everyone can listen to.',
  },
  {
    id: 'bandstop', title: 'FFT band-stop', subtitle: 'clear carrier band', kind: 'op', stage: 'cover-cleared', before: 'cover', x: COL * 4, y: ROW, order: 6,
    theory: 'The cover’s own content in the carrier band is removed (FFT bins zeroed) so it cannot interfere with the hidden signal. Very little energy lives up there, so the change is hard to hear.',
    formula: 'C[k] = 0,  k ∈ carrier band',
  },
  {
    id: 'mix', title: 'Σ  + IFFT', subtitle: 'add & inverse FFT', kind: 'mix', stage: 'stego', before: 'cover', x: COL * 5, y: ROW, order: 7,
    theory: 'The two spectra are added and a single inverse FFT returns the stego waveform. Peak is limited to avoid clipping.',
    formula: 's[n] = IFFT{ C[k] + Y[k] }',
  },
  {
    id: 'stego', title: 'Stego audio', subtitle: 'sounds like the cover', kind: 'output', stage: 'stego', before: 'cover', x: COL * 6, y: ROW, order: 8,
    theory: 'The output file. To a listener it is just the cover track; the speech is hidden, scrambled, at 16.5–19.9 kHz.',
  },
]

ENCODE_NODES.push(
  {
    id: 'text', title: 'Hidden text', subtitle: 'UTF-8 message', kind: 'input', x: COL * 2, y: ROW * 2, order: 0,
    theory: 'An optional short text travels in its own lane of the spectrum, independent of the voice. This is the “bitstream hidden in audio” half of the project.',
  },
  {
    id: 'aes', title: 'AES-256-GCM', subtitle: 'PBKDF2 key → encrypt', kind: 'op', x: COL * 3, y: ROW * 2, order: 2,
    theory: 'The text is encrypted with AES-256 in GCM mode. The key comes from the shared passphrase via PBKDF2-SHA256 (100 000 iterations, random salt). GCM appends a 16-byte authentication tag, so a wrong key or even one flipped bit is detected instead of producing garbage.',
    formula: 'frame = salt ‖ IV ‖ AES-GCM_K(text) ‖ tag',
  },
  {
    id: 'spread', title: 'BPSK + spreading', subtitle: '→ 20.1 – 21.9 kHz', kind: 'op', stage: 'text-lane', x: COL * 4, y: ROW * 2, order: 4,
    theory: 'A sync byte (0xA5) and a 16-bit length are put in front of the ciphertext and everything becomes a bitstream. Each bit is phase-coded (BPSK: phase 0 for 0, π for 1) onto 16 FFT bins of the 20.1–21.9 kHz lane, every bin multiplied by a key-seeded ±1 chip (direct-sequence spread spectrum). Above 20 kHz it is inaudible, and unlike the reference repo’s phase coding we own the magnitude of these bins, so nothing smears into the music.',
    formula: 'X[k₀+16i+c] = A · (−1)^{bᵢ} · chip_{16i+c}',
    normalize: true,
  },
)

export const ENCODE_EDGES: PipelineEdge[] = [
  { from: 'secret', to: 'fir' },
  { from: 'fir', to: 'reverse' },
  { from: 'reverse', to: 'fft-secret' },
  { from: 'fft-secret', to: 'invert' },
  { from: 'invert', to: 'permute' },
  { from: 'permute', to: 'shift' },
  { from: 'shift', to: 'mix', fromSide: 'bottom', toSide: 'top' },
  { from: 'cover', to: 'bandstop' },
  { from: 'bandstop', to: 'mix' },
  { from: 'mix', to: 'stego' },
  { from: 'text', to: 'aes' },
  { from: 'aes', to: 'spread' },
  { from: 'spread', to: 'mix' },
]

export const DECODE_NODES: PipelineNode<DecodeStageId>[] = [
  {
    id: 'received', title: 'Received audio', subtitle: 'r[n]', kind: 'input', stage: 'received', x: 0, y: 0, order: 0,
    theory: 'What arrived over the channel: the stego track, possibly with noise, volume change and 16-bit quantisation.',
  },
  {
    id: 'fft', title: 'FFT (DIT / DIF)', subtitle: 'radix-2 butterflies', kind: 'fft', stage: 'received', x: COL * 1, y: 0, order: 1,
    theory: 'One radix-2 FFT over the whole clip. See the Butterfly tab: the decoder runs exactly that code, (N/2)·log₂N butterflies in log₂N stages.',
    formula: 'X[k] = Σ r[n]·W_N^{nk}',
  },
  {
    id: 'bandpass', title: 'FFT band-pass', subtitle: 'keep 16.5 – 19.9 kHz', kind: 'op', stage: 'band-extracted', before: 'received', x: COL * 2, y: 0, order: 2,
    theory: 'An ideal band-pass in the frequency domain: only the carrier bins are kept. The music (below 16 kHz) is thrown away completely.',
    formula: 'B[k] = X[k]·rect(k ∈ carrier)',
    normalize: true,
  },
  {
    id: 'shift-down', title: 'Shift down', subtitle: '→ 150 – 3550 Hz', kind: 'op', stage: 'baseband', before: 'band-extracted', x: COL * 3, y: 0, order: 3,
    theory: 'The band is moved back to the speech range. It is still scrambled — listen: it does not sound like speech.',
    formula: 'Y[k] = B[k + Δk]',
    normalize: true,
  },
  {
    id: 'unpermute', title: 'Inverse permutation', subtitle: 'needs the key', kind: 'op', stage: 'depermuted', before: 'baseband', x: COL * 4, y: 0, order: 4,
    theory: 'The receiver regenerates the same permutation from the key and puts every sub-band back. A wrong key leaves the sub-bands shuffled and the audio unintelligible.',
    formula: 'Y_{π_key(i)} = B_i',
    normalize: true,
  },
  {
    id: 'uninvert', title: 'Spectral inversion', subtitle: '+ IFFT', kind: 'op', stage: 'deinverted', before: 'depermuted', x: COL * 4, y: ROW, order: 5,
    theory: 'Inversion is its own inverse, so applying it again restores the band; an inverse FFT returns to time. The result is the voice — but backwards. Listen to it!',
    formula: 'Y[k] = B*[k_lo + k_hi − k]',
    normalize: true,
  },
  {
    id: 'unreverse', title: 'Time reversal', subtitle: 'play it backwards', kind: 'op', stage: 'recovered', before: 'deinverted', x: COL * 5, y: ROW, order: 6,
    theory: 'Playing the reversed voice in reverse order reveals the message.',
    formula: 'x[n] = y[−n]',
    normalize: true,
  },
  {
    id: 'recovered', title: 'Secret voice', subtitle: 'recovered', kind: 'output', stage: 'recovered', x: COL * 6, y: ROW, order: 7,
    theory: 'The decoded speech, normalised for playback.',
    normalize: true,
  },
]

DECODE_NODES.push(
  {
    id: 'lane', title: 'Lane band-pass', subtitle: 'keep 20.1 – 21.9 kHz', kind: 'op', stage: 'text-lane', before: 'received', x: COL, y: ROW * 2, order: 2,
    theory: 'The same FFT that carries the voice also carries the text lane: its bins are simply read out.',
    normalize: true,
  },
  {
    id: 'despread', title: 'Despread + decide', subtitle: 'Σ chip·X[k] → sign', kind: 'op', x: COL * 2, y: ROW * 2, order: 3,
    theory: 'Every group of 16 bins is multiplied by the same key-seeded chips and summed. The signal adds up coherently (16× in amplitude) while noise adds randomly (4×): a 12 dB processing gain. The sign of the real part is the bit (BPSK decision). The first 24 bits must contain the sync byte 0xA5 and the payload length — with a wrong key the chips do not match and the header never syncs.',
    formula: 'b̂ᵢ = [ Re Σ_c chip_{16i+c} · X[k₀+16i+c] < 0 ]',
  },
  {
    id: 'decrypt', title: 'AES-GCM decrypt', subtitle: 'verify tag', kind: 'op', x: COL * 3, y: ROW * 2, order: 4,
    theory: 'The receiver derives the same AES key from the passphrase and the transmitted salt, then decrypts. If any bit is wrong or the key differs, the GCM tag check fails and nothing is revealed.',
    formula: 'text = AES-GCM⁻¹_K(ciphertext)  iff  tag ✓',
  },
  {
    id: 'message', title: 'Hidden text', subtitle: 'decrypted', kind: 'output', x: COL * 4, y: ROW * 2, order: 5,
    theory: 'The recovered text message.',
  },
)

export const DECODE_EDGES: PipelineEdge[] = [
  { from: 'received', to: 'fft' },
  { from: 'fft', to: 'bandpass' },
  { from: 'bandpass', to: 'shift-down' },
  { from: 'shift-down', to: 'unpermute' },
  { from: 'unpermute', to: 'uninvert', fromSide: 'bottom', toSide: 'top' },
  { from: 'uninvert', to: 'unreverse' },
  { from: 'unreverse', to: 'recovered' },
  { from: 'fft', to: 'lane', fromSide: 'bottom', toSide: 'top' },
  { from: 'lane', to: 'despread' },
  { from: 'despread', to: 'decrypt' },
  { from: 'decrypt', to: 'message' },
]
