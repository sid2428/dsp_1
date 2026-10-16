import { MAX_DURATION_S, SAMPLE_RATE } from '../dsp/constants'
import { encodeWav16, encodeWavFloat32 } from '../dsp/wav'
import { normalizePeak } from '../dsp/analysis'

export interface AudioClip {
  name: string
  samples: Float32Array
  duration: number
  /** True when the input was longer than MAX_DURATION_S and got trimmed. */
  truncated: boolean
  /** Details of the file or recording this clip was decoded from. */
  source?: ClipSourceInfo
}

export interface ClipSourceInfo {
  /** How the clip arrived. Only a live recording can be transcribed. */
  kind: 'file' | 'demo' | 'mic'
  /** Size in bytes of the encoded file or recorded blob. */
  bytes: number
  /** Container, e.g. "WAV" or "MP3". */
  format: string
  /** Channels in the source, before the mono downmix. */
  channels: number
  /** Sample rate stored in the file. Only containers we can read a header from report one. */
  sourceSampleRate: number | null
}

/** Refuse absurd inputs before handing them to the decoder, which would otherwise stall the tab. */
const MAX_FILE_BYTES = 80 * 1024 * 1024

const FORMATS: Record<string, string> = {
  'audio/wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/vnd.wave': 'WAV',
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/ogg': 'OGG',
  'audio/webm': 'WEBM',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/mp4': 'M4A',
  'audio/x-m4a': 'M4A',
  'audio/aac': 'AAC',
}

/** Best-effort container name from the MIME type, falling back to the file extension. */
export function audioFormatLabel(mimeType: string, name: string): string {
  const mime = mimeType.split(';')[0].trim().toLowerCase()
  if (FORMATS[mime]) return FORMATS[mime]
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''
  if (ext && ext.length <= 5) return ext
  const subtype = mime.split('/')[1]
  return subtype ? subtype.toUpperCase() : 'AUDIO'
}

/**
 * Sample rate and channels straight out of a RIFF/WAVE header.
 * decodeAudioData resamples to the context rate, so the file's own rate is only visible here.
 */
function readWavHeader(buf: ArrayBuffer): { sampleRate: number; channels: number } | null {
  if (buf.byteLength < 44) return null
  const view = new DataView(buf)
  const tag = (offset: number) => String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let offset = 12
  while (offset + 8 <= buf.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ' && offset + 16 <= buf.byteLength) {
      return { channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true) }
    }
    offset += 8 + size + (size % 2)
  }
  return null
}

const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/** Sample rate of the first MPEG audio frame, after any ID3v2 tag. */
function readMp3Rate(b: Uint8Array): number | null {
  let i = 0
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0)
  }
  for (const end = Math.min(b.length - 4, i + 64 * 1024); i < end; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue
    const version = (b[i + 1] >> 3) & 3
    const layer = (b[i + 1] >> 1) & 3
    const rateIdx = (b[i + 2] >> 2) & 3
    const bitrateIdx = b[i + 2] >> 4
    if (version === 1 || layer === 0 || rateIdx === 3 || bitrateIdx === 15) continue
    return MP3_RATES[version][rateIdx]
  }
  return null
}

/** The rate stored in the container, for the formats whose headers are simple to read. */
function readSourceRate(buf: ArrayBuffer): number | null {
  const wav = readWavHeader(buf)
  if (wav) return wav.sampleRate
  const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 128 * 1024))
  const ascii = (off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len))
  if (b.length > 22 && ascii(0, 4) === 'fLaC') return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4)
  if (b.length > 44 && ascii(0, 4) === 'OggS') {
    if (ascii(29, 6) === 'vorbis') return new DataView(buf).getUint32(40, true)
    if (ascii(28, 8) === 'OpusHead') return 48000 // Opus always codes at 48 kHz
  }
  return readMp3Rate(b)
}

/** Decodes any browser-supported audio (wav/mp3/ogg/webm...) to mono at SAMPLE_RATE. */
export async function decodeToClip(data: ArrayBuffer, name: string, origin: { kind: ClipSourceInfo['kind']; mimeType?: string } = { kind: 'file' }): Promise<AudioClip> {
  const bytes = data.byteLength
  if (bytes === 0) throw new Error(`"${name}" is empty — it contains no audio data.`)
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(`"${name}" is ${(bytes / 1024 / 1024).toFixed(0)} MB. Use a file under ${MAX_FILE_BYTES / 1024 / 1024} MB — only the first ${MAX_DURATION_S} s is used anyway.`)
  }
  const format = audioFormatLabel(origin.mimeType ?? '', name)
  const sourceRate = readSourceRate(data)
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  let buffer: AudioBuffer
  try {
    // decodeAudioData detaches the buffer, so parse any header before this point.
    buffer = await ctx.decodeAudioData(data)
  } catch {
    throw new Error(`Could not decode "${name}" (${format}). The file may be corrupt or use a codec this browser cannot read — try a WAV or MP3.`)
  }
  if (buffer.length === 0) throw new Error(`"${name}" decoded to zero samples — it contains no audio.`)
  const maxLen = Math.floor(MAX_DURATION_S * SAMPLE_RATE)
  const len = Math.min(buffer.length, maxLen)
  const mono = new Float32Array(len)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < len; i++) mono[i] += data[i] / buffer.numberOfChannels
  }
  return {
    name,
    samples: mono,
    duration: len / SAMPLE_RATE,
    truncated: buffer.length > maxLen,
    source: {
      kind: origin.kind,
      bytes,
      format,
      channels: buffer.numberOfChannels,
      sourceSampleRate: sourceRate,
    },
  }
}

export async function loadClipFromFile(file: File, kind: ClipSourceInfo['kind'] = 'file'): Promise<AudioClip> {
  return decodeToClip(await file.arrayBuffer(), file.name, { kind, mimeType: file.type })
}

export async function loadClipFromUrl(url: string, name: string, kind: ClipSourceInfo['kind'] = 'demo'): Promise<AudioClip> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`)
  return decodeToClip(await res.arrayBuffer(), name, { kind, mimeType: res.headers.get('content-type') ?? '' })
}

export function clipToWavBlob(samples: Float32Array, normalize = false): Blob {
  const data = normalize ? normalizePeak(samples, 0.9) : samples
  return new Blob([encodeWav16(data, SAMPLE_RATE)], { type: 'audio/wav' })
}

export type WavFormat = 'pcm16' | 'float32'

/** The exact bytes of a mono WAV file at SAMPLE_RATE, as it would be saved or sent. */
export function wavBytes(samples: Float32Array, format: WavFormat = 'pcm16'): ArrayBuffer {
  return format === 'float32' ? encodeWavFloat32(samples, SAMPLE_RATE) : encodeWav16(samples, SAMPLE_RATE)
}

/** Saves a blob through a temporary link; the object URL is released once the download has started. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadWav(samples: Float32Array, filename: string, format: WavFormat = 'pcm16'): void {
  downloadBlob(new Blob([wavBytes(samples, format)], { type: 'audio/wav' }), filename)
}

export function downloadText(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename)
}

/** Microphone recorder built on MediaRecorder, with a live input meter from an AnalyserNode. */
export class MicRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  startedAt = 0

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is not supported in this browser.')
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record audio (MediaRecorder is missing).')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      throw new Error(
        name === 'NotFoundError'
          ? 'No microphone was found.'
          : name === 'NotReadableError'
            ? 'The microphone is in use by another application.'
            : 'Microphone permission was denied. Allow it in the browser’s site settings to record.',
      )
    }
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    try {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.buf = new Float32Array(this.analyser.fftSize)
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser)
    } catch {
      this.ctx = null
      this.analyser = null
    }
    this.recorder.start()
    this.startedAt = performance.now()
  }

  /** Current input RMS (0–1) of the live microphone, or 0 when no meter is available. */
  level(): number {
    if (!this.analyser || !this.buf) return 0
    this.analyser.getFloatTimeDomainData(this.buf)
    let e = 0
    for (let i = 0; i < this.buf.length; i++) e += this.buf[i] * this.buf[i]
    return Math.sqrt(e / this.buf.length)
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
    this.analyser = null
    this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }

  /** Stops without decoding anything (used when the recording is abandoned). */
  discard(): void {
    const rec = this.recorder
    if (rec) {
      rec.onstop = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
    this.chunks = []
    this.release()
  }

  stop(): Promise<AudioClip> {
    const rec = this.recorder
    if (!rec) return Promise.reject(new Error('Recorder is not running'))
    return new Promise((resolve, reject) => {
      rec.onstop = async () => {
        this.release()
        try {
          const blob = new Blob(this.chunks, { type: rec.mimeType })
          this.chunks = []
          resolve(await decodeToClip(await blob.arrayBuffer(), 'Microphone recording', { kind: 'mic', mimeType: rec.mimeType }))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
      rec.stop()
    })
  }
}
