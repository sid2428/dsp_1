import type { ChannelParams } from '../dsp/channel'
import type { DecodeParams, EncodeParams } from '../dsp/stego'
import type { ChannelOutput, DecodeOutput, EncodeOutput, WorkerRequest, WorkerResponse } from './protocol'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

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
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error))
  }
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'DSP worker crashed')
    pending.forEach((p) => p.reject(err))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** Sends copies of the inputs (so the caller keeps its arrays) and awaits the worker's reply. */
function call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: ArrayBuffer[]): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ ...req, id } as WorkerRequest, transfer)
  })
}

/** Starts the worker early and lets it JIT-compile the FFT while the user is still choosing audio. */
export function warmUpWorker(): void {
  call<null>({ type: 'warmup' }, []).catch(() => {
    /* warm-up is best effort */
  })
}

export function runEncode(cover: Float32Array, secret: Float32Array, sampleRate: number, params: EncodeParams, text: string) {
  const c = cover.slice()
  const s = secret.slice()
  return call<EncodeOutput>({ type: 'encode', cover: c, secret: s, sampleRate, params, text }, [c.buffer, s.buffer])
}

export function runChannel(stego: Float32Array, sampleRate: number, params: ChannelParams) {
  const s = stego.slice()
  return call<ChannelOutput>({ type: 'channel', stego: s, sampleRate, params }, [s.buffer])
}

export function runDecode(
  received: Float32Array,
  sampleRate: number,
  params: DecodeParams,
  reference: Float32Array | null,
  referenceBits: Uint8Array | null,
) {
  const r = received.slice()
  const ref = reference ? reference.slice() : null
  const refBits = referenceBits ? referenceBits.slice() : null
  const transfer = [r.buffer, ...(ref ? [ref.buffer] : []), ...(refBits ? [refBits.buffer] : [])]
  return call<DecodeOutput>({ type: 'decode', received: r, sampleRate, params, reference: ref, referenceBits: refBits }, transfer)
}
