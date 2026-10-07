import { MAX_DURATION_S, SAMPLE_RATE } from '../dsp/constants'
import { encodeWav16 } from '../dsp/wav'
import { normalizePeak } from '../dsp/analysis'

export interface AudioClip {
  name: string
  samples: Float32Array
  duration: number
  /** True when the input was longer than MAX_DURATION_S and got trimmed. */
  truncated: boolean
}

/** Decodes any browser-supported audio (wav/mp3/ogg/webm...) to mono at SAMPLE_RATE. */
export async function decodeToClip(data: ArrayBuffer, name: string): Promise<AudioClip> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(data)
  } catch {
    throw new Error(`Could not decode "${name}". Try a WAV or MP3 file.`)
  }
  const maxLen = Math.floor(MAX_DURATION_S * SAMPLE_RATE)
  const len = Math.min(buffer.length, maxLen)
  const mono = new Float32Array(len)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < len; i++) mono[i] += data[i] / buffer.numberOfChannels
  }
  return { name, samples: mono, duration: len / SAMPLE_RATE, truncated: buffer.length > maxLen }
}

export async function loadClipFromFile(file: File): Promise<AudioClip> {
  return decodeToClip(await file.arrayBuffer(), file.name)
}

export async function loadClipFromUrl(url: string, name: string): Promise<AudioClip> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`)
  return decodeToClip(await res.arrayBuffer(), name)
}

export function clipToWavBlob(samples: Float32Array, normalize = false): Blob {
  const data = normalize ? normalizePeak(samples, 0.9) : samples
  return new Blob([encodeWav16(data, SAMPLE_RATE)], { type: 'audio/wav' })
}

export function downloadWav(samples: Float32Array, filename: string): void {
  const url = URL.createObjectURL(clipToWavBlob(samples))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Microphone recorder built on MediaRecorder. */
export class MicRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is not supported in this browser')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      throw new Error('Microphone permission was denied')
    }
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  stop(): Promise<AudioClip> {
    const rec = this.recorder
    if (!rec) return Promise.reject(new Error('Recorder is not running'))
    return new Promise((resolve, reject) => {
      rec.onstop = async () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
        this.recorder = null
        try {
          const blob = new Blob(this.chunks, { type: rec.mimeType })
          resolve(await decodeToClip(await blob.arrayBuffer(), 'Microphone recording'))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
      rec.stop()
    })
  }
}
