import type { ChannelParams } from '../dsp/channel'
import type { DecodeParams, EncodeParams } from '../dsp/stego'
import type { ChannelOutput, CompareOutput, DecodeOutput, EncodeOutput, StageTiming, StressResult, StressScenario, WorkerRequest, WorkerResponse } from './protocol'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (t: StageTiming) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./dsp-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data
    const p = pending.get(msg.id)
    if (!p) return
    if ('progress' in msg) {
      p.onProgress?.(msg.progress)
      return
    }
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error))
  }
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'The DSP worker crashed')
    pending.forEach((p) => p.reject(err))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

/** Stops whatever the worker is doing by terminating it; every pending call rejects with CancelledError. */
export function cancelAll(): void {
  if (!worker) return
  worker.terminate()
  worker = null
  pending.forEach((p) => p.reject(new CancelledError()))
  pending.clear()
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** Sends copies of the inputs (so the caller keeps its arrays) and awaits the worker's reply. */
function call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: ArrayBuffer[], onProgress?: (t: StageTiming) => void): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    getWorker().postMessage({ ...req, id } as WorkerRequest, transfer)
  })
}

/** Starts the worker early and lets it JIT-compile the FFT while the user is still choosing audio. */
export function warmUpWorker(): void {
  call<null>({ type: 'warmup' }, []).catch(() => {
    /* warm-up is best effort */
  })
}

export function runEncode(
  cover: Float32Array,
  secret: Float32Array | null,
  sampleRate: number,
  params: Omit<EncodeParams, 'onProgress' | 'textBits'>,
  text: string,
  onProgress?: (t: StageTiming) => void,
) {
  const c = cover.slice()
  const s = secret ? secret.slice() : null
  return call<EncodeOutput>({ type: 'encode', cover: c, secret: s, sampleRate, params, text }, [c.buffer, ...(s ? [s.buffer] : [])], onProgress)
}

export function runChannel(stego: Float32Array, sampleRate: number, params: ChannelParams) {
  const s = stego.slice()
  return call<ChannelOutput>({ type: 'channel', stego: s, sampleRate, params }, [s.buffer])
}

/** Receiver-side decode: only the received samples and the receiver's own key cross into the worker. */
export function runDecode(received: Float32Array, sampleRate: number, params: Omit<DecodeParams, 'onProgress' | 'wrongKey'>, onProgress?: (t: StageTiming) => void) {
  const r = received.slice()
  return call<DecodeOutput>({ type: 'decode', received: r, sampleRate, params }, [r.buffer], onProgress)
}

export function runCompare(input: {
  cover: Float32Array
  stego: Float32Array
  secretReference: Float32Array | null
  sentBits: Uint8Array | null
  received: Float32Array
  recovered: Float32Array
  receivedBits: Uint8Array
}) {
  const req = {
    cover: input.cover.slice(),
    stego: input.stego.slice(),
    secretReference: input.secretReference?.slice() ?? null,
    sentBits: input.sentBits?.slice() ?? null,
    received: input.received.slice(),
    recovered: input.recovered.slice(),
    receivedBits: input.receivedBits.slice(),
  }
  const transfer = [req.cover.buffer, req.stego.buffer, req.received.buffer, req.recovered.buffer, req.receivedBits.buffer]
  if (req.secretReference) transfer.push(req.secretReference.buffer)
  if (req.sentBits) transfer.push(req.sentBits.buffer)
  return call<CompareOutput>({ type: 'compare', ...req }, transfer)
}

/** Sender-side robustness check: each scenario goes through the real channel and decoder with the sender's key. */
export function runStress(stego: Float32Array, sampleRate: number, key: string, scenarios: StressScenario[], reference: Float32Array | null, onProgress?: (t: StageTiming) => void) {
  const s = stego.slice()
  const ref = reference ? reference.slice() : null
  return call<StressResult[]>({ type: 'stress', stego: s, sampleRate, key, scenarios, reference: ref }, [s.buffer, ...(ref ? [ref.buffer] : [])], onProgress)
}
