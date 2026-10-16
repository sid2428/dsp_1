import { create } from 'zustand'
import { decodeToClip, wavBytes, type AudioClip } from '../audio/load-audio'
import { CLEAN_CHANNEL, type ChannelParams } from '../dsp/channel'
import { DEFAULT_STRENGTH_DB, SAMPLE_RATE } from '../dsp/constants'
import type { FftKind } from '../dsp/fft'
import { validateSender, type PayloadMode } from '../steps/sender-validation'
import { cancelAll, CancelledError, runChannel, runCompare, runDecode, runEncode, runStress, warmUpWorker } from '../worker/dsp-client'
import type { ChannelOutput, CompareOutput, DecodeOutput, DecodeStep, EncodeOutput, EncodeStep, StageTiming, StressResult, StressScenario } from '../worker/protocol'

export const STEPS = ['Sender', 'Encode', 'Channel', 'Receiver', 'Output'] as const
export type StepIndex = 0 | 1 | 2 | 3 | 4
export type UIMode = 'beginner' | 'dsp'

type Busy = null | 'encode' | 'channel' | 'decode' | 'deliver' | 'stress'

export type ChannelPreset = 'clean' | 'noisy' | 'lowpass'

/** Presets are nothing but simulator settings; the stress test runs exactly these. */
export const CHANNEL_PRESETS: Record<ChannelPreset, { label: string; params: ChannelParams }> = {
  clean: { label: 'Clean', params: { noiseSnrDb: null, quantize16: true, gainDb: 0, lowpassHz: null } },
  noisy: { label: 'Noisy · 20 dB', params: { noiseSnrDb: 20, quantize16: true, gainDb: -3, lowpassHz: null } },
  lowpass: { label: 'Low-pass · 16 kHz', params: { noiseSnrDb: null, quantize16: true, gainDb: 0, lowpassHz: 16000 } },
}

export function presetOf(c: ChannelParams): ChannelPreset | null {
  for (const [id, p] of Object.entries(CHANNEL_PRESETS) as [ChannelPreset, (typeof CHANNEL_PRESETS)[ChannelPreset]][]) {
    const q = p.params
    if (q.noiseSnrDb === c.noiseSnrDb && q.quantize16 === c.quantize16 && q.gainDb === c.gainDb && (q.lowpassHz ?? null) === (c.lowpassHz ?? null)) return id
  }
  return null
}

/** Where the receiver's file came from. Only used for labelling — decoding never looks at it. */
export type ReceivedOrigin = 'upload' | 'transfer-stego' | 'transfer-channel'

interface StegoState {
  step: StepIndex
  uiMode: UIMode
  cover: AudioClip | null
  secret: AudioClip | null
  key: string
  /** Level of the hidden voice band relative to the cover; fixed, no longer user-tunable. */
  strengthDb: number
  /** Text hidden in the encrypted bit lane. */
  hiddenText: string
  /** Exactly one payload is hidden; the other input keeps its content but is not used. */
  payloadMode: PayloadMode
  channel: ChannelParams

  encoded: EncodeOutput | null
  /** Stages finished so far by the running (or last) encode, as reported by the worker. */
  encodeLog: StageTiming<EncodeStep>[]
  encodeError: string | null

  transmitted: ChannelOutput | null
  channelError: string | null
  stress: StressResult[] | null
  stressProgress: number
  stressError: string | null

  receivedFile: AudioClip | null
  receivedOrigin: ReceivedOrigin | null
  receiverKey: string
  /** Fixed: the decoder uses the same radix-2 DIT routine as the encoder; not a user setting. */
  fftKind: FftKind
  decoded: DecodeOutput | null
  decodeLog: StageTiming<DecodeStep>[]
  decodeError: string | null
  /** Sender-vs-receiver lab comparison, only when the received file is derived from this session's stego. */
  comparison: CompareOutput | null

  busy: Busy
  /** The last operation the user cancelled, so the UI can say so instead of showing an error. */
  cancelled: Exclude<Busy, null> | null
  /** Bumped whenever a sender input changes, so an encode that finishes late cannot install stale output. */
  senderVersion: number
  /** Same for receiver inputs (file, key, FFT variant). */
  receiverVersion: number

  goTo: (step: StepIndex) => void
  canVisit: (step: StepIndex) => boolean
  setUIMode: (mode: UIMode) => void
  setCover: (clip: AudioClip | null) => void
  setSecret: (clip: AudioClip | null) => void
  setKey: (key: string) => void
  setHiddenText: (text: string) => void
  setPayloadMode: (mode: PayloadMode) => void
  setChannel: (patch: Partial<ChannelParams>) => void
  applyPreset: (preset: ChannelPreset) => void
  setReceiverKey: (key: string) => void
  setReceivedFile: (clip: AudioClip | null, origin?: ReceivedOrigin) => void
  encode: () => Promise<boolean>
  transmit: () => Promise<boolean>
  /** Writes the chosen audio to real WAV bytes and decodes them as the receiver's file. */
  deliver: (which: 'stego' | 'channel') => Promise<boolean>
  decode: () => Promise<boolean>
  compare: () => Promise<void>
  runStressTest: () => Promise<void>
  cancel: () => void
  resetSession: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const senderInvalidated = (s: StegoState) => ({
  encoded: null,
  encodeLog: [],
  encodeError: null,
  transmitted: null,
  channelError: null,
  stress: null,
  stressError: null,
  comparison: null,
  senderVersion: s.senderVersion + 1,
})

const receiverInvalidated = (s: StegoState) => ({
  decoded: null,
  decodeLog: [],
  decodeError: null,
  comparison: null,
  receiverVersion: s.receiverVersion + 1,
})

const INITIAL = {
  step: 0 as StepIndex,
  cover: null,
  secret: null,
  key: '',
  strengthDb: DEFAULT_STRENGTH_DB,
  hiddenText: '',
  payloadMode: 'text' as PayloadMode,
  channel: CLEAN_CHANNEL,
  encoded: null,
  encodeLog: [],
  encodeError: null,
  transmitted: null,
  channelError: null,
  stress: null,
  stressProgress: 0,
  stressError: null,
  receivedFile: null,
  receivedOrigin: null,
  // The receiver starts with nothing: the key must be typed in on the Receiver step.
  receiverKey: '',
  fftKind: 'dit' as FftKind,
  decoded: null,
  decodeLog: [],
  decodeError: null,
  comparison: null,
  busy: null,
  cancelled: null,
}

export const useStegoStore = create<StegoState>((set, get) => ({
  ...INITIAL,
  uiMode: 'beginner',
  senderVersion: 0,
  receiverVersion: 0,

  canVisit: (step) => {
    const s = get()
    switch (step) {
      case 0:
      case 3: // the receiving station works on its own, e.g. on another computer
        return true
      case 1:
        return !!s.encoded || s.busy === 'encode' || !!s.encodeError || validateSender({ ...s, mode: s.payloadMode }).ready
      case 2:
        return !!s.encoded
      case 4:
        return !!s.decoded
    }
  },
  goTo: (step) => {
    if (get().canVisit(step)) set({ step })
  },
  setUIMode: (uiMode) => set({ uiMode }),

  // Changing an upstream input invalidates everything computed from it, on the sender side only:
  // the receiver's file and result belong to the receiver.
  setCover: (cover) => set((s) => ({ cover, ...senderInvalidated(s) })),
  setSecret: (secret) => set((s) => ({ secret, ...senderInvalidated(s) })),
  setKey: (key) => set((s) => ({ key, ...senderInvalidated(s) })),
  setHiddenText: (hiddenText) => set((s) => ({ hiddenText, ...senderInvalidated(s) })),
  setPayloadMode: (payloadMode) => set((s) => (s.payloadMode === payloadMode ? {} : { payloadMode, ...senderInvalidated(s) })),
  setChannel: (patch) => set((s) => ({ channel: { ...s.channel, ...patch }, transmitted: null, channelError: null })),
  applyPreset: (preset) => set({ channel: { ...CHANNEL_PRESETS[preset].params }, transmitted: null, channelError: null }),
  setReceiverKey: (receiverKey) => set((s) => (s.receiverKey === receiverKey ? {} : { receiverKey, ...receiverInvalidated(s) })),
  setReceivedFile: (receivedFile, origin = 'upload') =>
    set((s) => ({ receivedFile, receivedOrigin: receivedFile ? origin : null, ...receiverInvalidated(s) })),

  encode: async () => {
    const s = get()
    if (s.busy) return false
    const status = validateSender({ ...s, mode: s.payloadMode })
    if (!status.ready || !s.cover) {
      set({ encodeError: status.blocking[0]?.detail ?? 'The sender inputs are incomplete.' })
      return false
    }
    const version = s.senderVersion
    const current = () => get().senderVersion === version
    set({ busy: 'encode', cancelled: null, encodeLog: [], encodeError: null, encoded: null, transmitted: null, stress: null })
    const voice = s.payloadMode === 'voice'
    try {
      const encoded = await runEncode(
        s.cover.samples,
        voice ? (s.secret?.samples ?? null) : null,
        SAMPLE_RATE,
        { key: s.key, strengthDb: s.strengthDb, fftKind: 'dit' },
        voice ? '' : s.hiddenText,
        (t) => {
          if (current()) set((st) => ({ encodeLog: [...st.encodeLog, t as StageTiming<EncodeStep>] }))
        },
      )
      if (!current()) {
        set({ busy: null })
        return false
      }
      set({ encoded, encodeLog: encoded.log, busy: null })
      return true
    } catch (e) {
      if (e instanceof CancelledError) return false
      set({ busy: null, ...(current() ? { encodeError: message(e) } : {}) })
      return false
    }
  },

  transmit: async () => {
    const { encoded, channel, busy, senderVersion } = get()
    if (busy || !encoded) return false
    set({ busy: 'channel', channelError: null })
    try {
      // a fresh noise realisation every time the file is "sent"
      const seed = (Math.random() * 2 ** 31) >>> 0
      const transmitted = await runChannel(encoded.stages.stego.samples, SAMPLE_RATE, { ...channel, seed })
      if (get().senderVersion !== senderVersion || get().encoded !== encoded) {
        set({ busy: null })
        return false
      }
      set({ transmitted, busy: null })
      return true
    } catch (e) {
      set({ busy: null, channelError: message(e) })
      return false
    }
  },

  deliver: async (which) => {
    const { encoded, transmitted, busy } = get()
    if (busy) return false
    const source = which === 'stego' ? encoded?.stages.stego.samples : transmitted?.received.samples
    if (!source) return false
    set({ busy: 'deliver' })
    try {
      // A channel that does not quantise keeps its float samples, so it travels as a float WAV.
      const format = which === 'channel' && transmitted && !transmitted.params.quantize16 ? 'float32' : 'pcm16'
      const name = which === 'stego' ? 'stego.wav' : 'received.wav'
      const clip = await decodeToClip(wavBytes(source, format), name, { kind: 'file', mimeType: 'audio/wav' })
      set((s) => ({ busy: null, receivedFile: clip, receivedOrigin: which === 'stego' ? 'transfer-stego' : 'transfer-channel', ...receiverInvalidated(s) }))
      return true
    } catch (e) {
      set({ busy: null, channelError: `Could not hand the file over: ${message(e)}` })
      return false
    }
  },

  decode: async () => {
    const { receivedFile, receiverKey, fftKind, busy, receiverVersion } = get()
    if (busy) return false
    if (!receivedFile) {
      set({ decodeError: 'Load the received audio first.' })
      return false
    }
    if (receiverKey.trim().length === 0) {
      set({ decodeError: 'Enter the key the sender shared with you.' })
      return false
    }
    const current = () => get().receiverVersion === receiverVersion
    set({ busy: 'decode', cancelled: null, decodeError: null, decoded: null, decodeLog: [], comparison: null })
    try {
      const decoded = await runDecode(receivedFile.samples, SAMPLE_RATE, { key: receiverKey, fftKind }, (t) => {
        if (current()) set((st) => ({ decodeLog: [...st.decodeLog, t as StageTiming<DecodeStep>] }))
      })
      if (!current()) {
        set({ busy: null })
        return false
      }
      set({ decoded, decodeLog: decoded.log, busy: null })
      return true
    } catch (e) {
      if (e instanceof CancelledError) return false
      set({ busy: null, ...(current() ? { decodeError: message(e) } : {}) })
      return false
    }
  },

  compare: async () => {
    const { encoded, decoded, receivedFile } = get()
    if (!encoded || !decoded || !receivedFile) {
      set({ comparison: null })
      return
    }
    try {
      const comparison = await runCompare({
        cover: encoded.stages.cover.samples,
        stego: encoded.stages.stego.samples,
        secretReference: encoded.hasVoice ? encoded.stages['secret-bandlimited'].samples : null,
        sentBits: encoded.text?.bits ?? null,
        received: receivedFile.samples,
        recovered: decoded.stages.recovered.samples,
        receivedBits: decoded.text.bits,
      })
      // only keep it if nothing changed while it ran
      const s = get()
      if (s.encoded === encoded && s.decoded === decoded) set({ comparison })
    } catch {
      set({ comparison: null })
    }
  },

  runStressTest: async () => {
    const { encoded, key, busy, senderVersion } = get()
    if (busy || !encoded) return
    const scenarios: StressScenario[] = (Object.keys(CHANNEL_PRESETS) as ChannelPreset[]).map((id) => ({
      id,
      label: CHANNEL_PRESETS[id].label,
      // a fixed seed so the noisy scenario is reproducible run to run
      params: { ...CHANNEL_PRESETS[id].params, seed: 20261016 },
    }))
    set({ busy: 'stress', cancelled: null, stress: null, stressProgress: 0, stressError: null })
    try {
      const stress = await runStress(encoded.stages.stego.samples, SAMPLE_RATE, key, scenarios, encoded.hasVoice ? encoded.stages['secret-bandlimited'].samples : null, () =>
        set((st) => ({ stressProgress: st.stressProgress + 1 })),
      )
      if (get().senderVersion !== senderVersion) {
        set({ busy: null })
        return
      }
      set({ stress, busy: null })
    } catch (e) {
      if (e instanceof CancelledError) return
      set({ busy: null, stressError: message(e) })
    }
  },

  /** Terminates the worker (the only way to stop a running FFT) and starts a fresh one. */
  cancel: () => {
    const { busy } = get()
    if (!busy || busy === 'deliver') return
    cancelAll()
    set({ busy: null, cancelled: busy, ...(busy === 'encode' ? { encodeLog: [] } : busy === 'decode' ? { decodeLog: [] } : {}) })
    warmUpWorker()
  },

  resetSession: () => set((s) => ({ ...INITIAL, senderVersion: s.senderVersion + 1, receiverVersion: s.receiverVersion + 1 })),
}))
