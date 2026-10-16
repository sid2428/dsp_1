import type { Psd, Spectrogram } from '../dsp/analysis'
import type { FrameContent } from '../dsp/bit-lane'
import type { ChannelParams } from '../dsp/channel'
import type { FrequencyResponse } from '../dsp/fir'
import type { BandLayout } from '../dsp/spectral-ops'
import type { DecodeParams, DecodeProgressStage, DecodeStageId, EncodeParams, EncodeProgressStage, EncodeStageId } from '../dsp/stego'

/** Audio of one pipeline stage plus what the UI needs to draw it. */
export interface StageView {
  samples: Float32Array
  psd: Psd
  spec: Spectrogram
}

/** What the sender put into the hidden text lane. */
export interface TextLaneInfo {
  /** Empty for a voice-only frame (header only). */
  plaintext: string
  /** Encrypted frame: salt | iv | ciphertext | tag (empty for a voice-only frame). */
  cipher: Uint8Array
  /** Header + ciphertext as 0/1 bits (what is BPSK-modulated). */
  bits: Uint8Array
  content: FrameContent
  capacityBytes: number
  usedBins: number
  laneBins: number
  chipsPerBit: number
  laneLowHz: number
  laneHighHz: number
}

/**
 * ok             — frame synced, ciphertext authenticated by AES-GCM and decrypted
 * voice-verified — voice frame synced and its AES-GCM key token authenticated (the key is verified; the
 *                  analogue voice itself cannot be authenticated)
 * auth-failed    — frame synced but AES-GCM rejected it (wrong key, or damaged bits)
 * no-payload     — no frame synced (wrong key, not a stego file, damaged lane, or an original voice-only file
 *                  that never carried a frame — for those, key verification is unavailable)
 */
export type TextStatus = 'ok' | 'voice-verified' | 'auth-failed' | 'no-payload'

/** What the receiver got out of the text lane — computed from the received audio and key only. */
export interface TextDecodeInfo {
  status: TextStatus
  text: string | null
  content: FrameContent | null
  /** Bits read (header + payload). */
  bits: Uint8Array
  /** Despread symbols (normalised), at most ~1500 points, for the constellation plot. */
  softRe: Float32Array
  softIm: Float32Array
  headerLength: number
}

/** One finished processing stage, as measured inside the worker. */
export interface StageTiming<S extends string = string> {
  stage: S
  ms: number
}

export type EncodeStep = 'aes' | EncodeProgressStage | 'analysis'
export type DecodeStep = DecodeProgressStage | 'decrypt' | 'analysis'

export interface EncodeOutput {
  stages: Record<EncodeStageId, StageView>
  layout: BandLayout
  permutation: number[]
  gain: number
  clipScale: number
  secretTruncated: boolean
  hasVoice: boolean
  firResponse: FrequencyResponse
  fftSize: number
  totalMs: number
  log: StageTiming<EncodeStep>[]
  text: TextLaneInfo | null
}

export interface ChannelOutput {
  received: StageView
  /** Broadband SNR of the received file against the clean stego file. */
  channelSnrDb: number
  /** SNR inside the voice carrier band and inside the text lane — what decides recovery. */
  voiceBandSnrDb: number
  textLaneSnrDb: number
  params: ChannelParams
}

export interface DecodeOutput {
  stages: Record<DecodeStageId, StageView>
  layout: BandLayout
  permutation: number[]
  fftMs: number
  fftSize: number
  fftStages: number
  butterflyCount: number
  totalMs: number
  log: StageTiming<DecodeStep>[]
  /** Level of the carrier band relative to the whole received file (dB): near −∞ means the band is empty. */
  carrierLevelDb: number
  laneLowHz: number
  laneHighHz: number
  text: TextDecodeInfo
  /** Control experiment: the same file decoded with a deliberately wrong key. */
  wrongKey: { key: string; recovered: StageView; text: TextDecodeInfo }
}

export interface RecoveryMetrics {
  snrDb: number
  segSnrDb: number
  correlation: number
}

/** Sender-vs-receiver comparison; only meaningful when the received file came from this session's stego. */
export interface CompareOutput {
  /** Correlation of the received audio with this session's stego file (null when the lengths differ). */
  stegoCorrelation: number | null
  linked: boolean
  coverSnrDb: number | null
  voice: RecoveryMetrics | null
  ber: { errors: number; compared: number; ber: number } | null
}

export type WorkerRequest =
  | { type: 'warmup'; id: number }
  | {
      type: 'encode'
      id: number
      cover: Float32Array
      secret: Float32Array | null
      sampleRate: number
      params: Omit<EncodeParams, 'onProgress' | 'textBits'>
      /** Hidden text to encrypt into the bit lane ('' = none). */
      text: string
    }
  | { type: 'channel'; id: number; stego: Float32Array; sampleRate: number; params: ChannelParams }
  | { type: 'decode'; id: number; received: Float32Array; sampleRate: number; params: Omit<DecodeParams, 'onProgress' | 'wrongKey'> }
  | { type: 'stress'; id: number; stego: Float32Array; sampleRate: number; key: string; scenarios: StressScenario[]; reference: Float32Array | null }
  | {
      type: 'compare'
      id: number
      cover: Float32Array
      stego: Float32Array
      secretReference: Float32Array | null
      sentBits: Uint8Array | null
      received: Float32Array
      recovered: Float32Array
      receivedBits: Uint8Array
    }

export interface StressScenario {
  id: string
  label: string
  params: ChannelParams
}

/** One channel scenario run end to end: channel → decode with the sender's key → AES-GCM check. */
export interface StressResult {
  id: string
  label: string
  params: ChannelParams
  status: TextStatus
  /** Text recovered and identical to what was sent (null when no text was sent). */
  textIntact: boolean | null
  voiceCorrelation: number | null
  voiceBandSnrDb: number
  textLaneSnrDb: number
}

export type WorkerResult = EncodeOutput | ChannelOutput | DecodeOutput | CompareOutput | StressResult[] | null

export type WorkerResponse =
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: string }
  | { id: number; progress: StageTiming }
