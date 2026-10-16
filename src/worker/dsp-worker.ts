/// <reference lib="webworker" />
import { bandSnrDb, correlation, energy, gainMatchedSnrDb, segmentalSnrDb, snrDb, spectrogram, welchPsd } from '../dsp/analysis'
import { bitErrorRate, computeLaneLayout, frameBits, payloadCapacityBytes, type FrameContent, type LaneReadout } from '../dsp/bit-lane'
import { applyChannel } from '../dsp/channel'
import { CRYPTO_OVERHEAD, decryptText, encryptText } from '../dsp/crypto'
import { gaussianNoise } from '../dsp/prng'
import { frequencyResponse } from '../dsp/fir'
import { computeLayout } from '../dsp/spectral-ops'
import { decode, encode, fftSizeFor } from '../dsp/stego'
import type {
  ChannelOutput,
  CompareOutput,
  DecodeOutput,
  DecodeStep,
  EncodeOutput,
  EncodeStep,
  StageTiming,
  StageView,
  StressResult,
  TextDecodeInfo,
  TextLaneInfo,
  WorkerRequest,
  WorkerResponse,
  WorkerResult,
} from './protocol'

declare const self: DedicatedWorkerGlobalScope

/** Correlation with the session's stego above which a received file is treated as derived from it. */
const LINK_CORRELATION = 0.5

function view(samples: Float32Array, sampleRate: number): StageView {
  return { samples, psd: welchPsd(samples, sampleRate, 2048, 0, 96), spec: spectrogram(samples, sampleRate, 1024, 300) }
}

function views<K extends string>(stages: Record<K, Float32Array>, sampleRate: number): Record<K, StageView> {
  const out = {} as Record<K, StageView>
  for (const k of Object.keys(stages) as K[]) out[k] = view(stages[k], sampleRate)
  return out
}

/** Encrypts the text (if any) and frames it as bits for the lane of a clip of this length. */
async function prepareText(text: string, key: string, hasVoice: boolean, length: number, sampleRate: number): Promise<TextLaneInfo | null> {
  const layout = computeLaneLayout(fftSizeFor(length), sampleRate)
  const hasText = text.trim().length > 0
  const content: FrameContent = hasText ? (hasVoice ? 'voice+text' : 'text') : 'voice'
  // a voice frame carries AES-GCM of an empty plaintext: a key token the receiver can authenticate
  const cipher = await encryptText(hasText ? text : '', key)
  if (!hasText && cipher.length > payloadCapacityBytes(layout)) return null // cover too short: verification unavailable
  const bits = frameBits(cipher, layout, content)
  return {
    plaintext: hasText ? text : '',
    cipher,
    bits,
    content,
    capacityBytes: payloadCapacityBytes(layout) - CRYPTO_OVERHEAD,
    usedBins: bits.length * layout.chipsPerBit,
    laneBins: layout.width,
    chipsPerBit: layout.chipsPerBit,
    laneLowHz: layout.start * layout.binHz,
    laneHighHz: (layout.start + layout.width) * layout.binHz,
  }
}

/** Evenly thins the constellation so the UI never draws more than ~1500 points. */
function thin(x: Float32Array, max = 1500): Float32Array {
  if (x.length <= max) return x.slice()
  const out = new Float32Array(max)
  for (let i = 0; i < max; i++) out[i] = x[Math.floor((i * x.length) / max)]
  return out
}

/** Despread symbols -> decrypted text and a normalised constellation. Uses only the lane and the key. */
async function readText(lane: LaneReadout, key: string): Promise<TextDecodeInfo> {
  let status: TextDecodeInfo['status'] = lane.status
  let text: string | null = null
  if (lane.status === 'ok' && lane.payload) {
    try {
      const plain = await decryptText(lane.payload, key)
      if (lane.content === 'voice') status = 'voice-verified'
      else text = plain
    } catch {
      status = 'auth-failed'
    }
  }
  // scale so a clean symbol sits at ±1
  const mags = Array.from(lane.softRe, Math.abs).sort((a, b) => a - b)
  const scale = mags[Math.floor(mags.length / 2)] || 1
  return {
    status,
    text,
    content: lane.content,
    bits: lane.bits,
    softRe: thin(lane.softRe.map((v) => v / scale)),
    softIm: thin(lane.softIm.map((v) => v / scale)),
    headerLength: lane.headerLength,
  }
}

/** Collects every typed-array buffer so results move to the main thread without copying. */
function transferables(value: unknown, acc = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) acc.add(value.buffer)
  } else if (Array.isArray(value)) {
    value.forEach((v) => transferables(v, acc))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => transferables(v, acc))
  }
  return [...acc]
}

/**
 * Runs one full encode/decode on a synthetic 10 s clip so the JIT has compiled every hot loop and the
 * worker heap is already grown by the time the user presses Encode (the first real run is ~2x faster).
 */
function warmup(): null {
  const len = 10 * 44100
  const noise = gaussianNoise(len, 99)
  const tone = Float32Array.from({ length: len }, (_, i) => 0.3 * Math.sin(i * 0.11))
  const enc = encode(noise, tone, 44100, { key: 'warmup', strengthDb: -20, fftKind: 'dit' })
  decode(enc.stages.stego, 44100, { key: 'warmup', fftKind: 'dif', wrongKey: 'x' })
  view(enc.stages.stego, 44100)
  return null
}

async function handle(req: WorkerRequest, report: (t: StageTiming) => void): Promise<WorkerResult> {
  const t0 = performance.now()
  switch (req.type) {
    case 'warmup':
      return warmup()
    case 'encode': {
      const log: StageTiming<EncodeStep>[] = []
      const step = (stage: EncodeStep, ms: number) => {
        log.push({ stage, ms })
        report({ stage, ms })
      }
      const text = await prepareText(req.text, req.params.key, req.secret !== null, req.cover.length, req.sampleRate)
      step('aes', performance.now() - t0)
      const r = encode(req.cover, req.secret, req.sampleRate, { ...req.params, textBits: text?.bits ?? null, onProgress: step })
      const ta = performance.now()
      const stages = views(r.stages, req.sampleRate)
      const firResponse = frequencyResponse(r.fir, req.sampleRate, 600)
      step('analysis', performance.now() - ta)
      return {
        stages,
        layout: r.layout,
        permutation: r.permutation,
        gain: r.gain,
        clipScale: r.clipScale,
        secretTruncated: r.secretTruncated,
        hasVoice: r.hasVoice,
        firResponse,
        fftSize: r.layout.n,
        totalMs: performance.now() - t0,
        log,
        text,
      } satisfies EncodeOutput
    }
    case 'channel': {
      const received = applyChannel(req.stego, req.params, req.sampleRate)
      // the two hidden bands exactly as the decoder will locate them
      const n = fftSizeFor(req.stego.length)
      const bin = req.sampleRate / n
      const layout = computeLaneLayout(n, req.sampleRate)
      const vl = computeLayout(n, req.sampleRate)
      return {
        received: view(received, req.sampleRate),
        channelSnrDb: snrDb(req.stego, received),
        voiceBandSnrDb: bandSnrDb(req.stego, received, req.sampleRate, vl.carrierLow * bin, (vl.carrierLow + vl.width) * bin),
        textLaneSnrDb: bandSnrDb(req.stego, received, req.sampleRate, layout.start * bin, (layout.start + layout.width) * bin),
        params: req.params,
      } satisfies ChannelOutput
    }
    case 'decode': {
      const log: StageTiming<DecodeStep>[] = []
      const step = (stage: DecodeStep, ms: number) => {
        log.push({ stage, ms })
        report({ stage, ms })
      }
      const wrongKeyStr = `${req.params.key}?`
      const r = decode(req.received, req.sampleRate, { ...req.params, wrongKey: wrongKeyStr, onProgress: step })
      const td = performance.now()
      const text = await readText(r.lane, req.params.key)
      const wrongText = await readText(r.wrongLane!, wrongKeyStr)
      step('decrypt', performance.now() - td)
      const ta = performance.now()
      const stages = views(r.stages, req.sampleRate)
      const wrongRecovered = view(r.wrongKeyRecovered ?? new Float32Array(req.received.length), req.sampleRate)
      const carrierLevelDb = 10 * Math.log10(Math.max(energy(r.stages['band-extracted']), 1e-30) / Math.max(energy(req.received), 1e-30))
      step('analysis', performance.now() - ta)
      return {
        stages,
        layout: r.layout,
        permutation: r.permutation,
        fftMs: r.fftMs,
        fftSize: r.fftSize,
        fftStages: r.fftStages,
        butterflyCount: r.butterflyCount,
        totalMs: performance.now() - t0,
        log,
        carrierLevelDb,
        laneLowHz: r.laneLayout.start * r.laneLayout.binHz,
        laneHighHz: (r.laneLayout.start + r.laneLayout.width) * r.laneLayout.binHz,
        text,
        wrongKey: { key: wrongKeyStr, recovered: wrongRecovered, text: wrongText },
      } satisfies DecodeOutput
    }
    case 'stress': {
      const n = fftSizeFor(req.stego.length)
      const bin = req.sampleRate / n
      const lane = computeLaneLayout(n, req.sampleRate)
      const vl = computeLayout(n, req.sampleRate)
      const out: StressResult[] = []
      for (const sc of req.scenarios) {
        const rx = applyChannel(req.stego, sc.params, req.sampleRate)
        const r = decode(rx, req.sampleRate, { key: req.key, fftKind: 'dit' })
        const t = await readText(r.lane, req.key)
        out.push({
          id: sc.id,
          label: sc.label,
          params: sc.params,
          status: t.status,
          textIntact: null,
          voiceCorrelation: req.reference ? correlation(req.reference, r.stages.recovered) : null,
          voiceBandSnrDb: bandSnrDb(req.stego, rx, req.sampleRate, vl.carrierLow * bin, (vl.carrierLow + vl.width) * bin),
          textLaneSnrDb: bandSnrDb(req.stego, rx, req.sampleRate, lane.start * bin, (lane.start + lane.width) * bin),
          ...(t.text !== null ? { textIntact: true } : {}),
        })
        report({ stage: sc.id, ms: 0 })
      }
      return out
    }
    case 'compare': {
      const sameLength = req.received.length === req.stego.length
      const stegoCorrelation = sameLength ? correlation(req.stego, req.received) : null
      const linked = stegoCorrelation !== null && stegoCorrelation > LINK_CORRELATION
      if (!linked) return { stegoCorrelation, linked, coverSnrDb: null, voice: null, ber: null } satisfies CompareOutput
      const ref = req.secretReference
      return {
        stegoCorrelation,
        linked,
        coverSnrDb: gainMatchedSnrDb(req.cover, req.stego),
        voice: ref
          ? { snrDb: gainMatchedSnrDb(ref, req.recovered), segSnrDb: segmentalSnrDb(ref, req.recovered), correlation: correlation(ref, req.recovered) }
          : null,
        ber: req.sentBits ? bitErrorRate(req.sentBits, req.receivedBits) : null,
      } satisfies CompareOutput
    }
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  const report = (progress: StageTiming) => self.postMessage({ id: req.id, progress } satisfies WorkerResponse)
  try {
    const result = await handle(req, report)
    const msg: WorkerResponse = { id: req.id, ok: true, result }
    self.postMessage(msg, result ? transferables(result) : [])
  } catch (err) {
    const msg: WorkerResponse = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(msg)
  }
}
