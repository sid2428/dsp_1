/** Encodes mono float samples as a 16-bit PCM WAV file (clipped to [-1, 1]). */
export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM format
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, Math.round(c * 32767), true)
  }
  return buf
}

/** Minimal 16-bit PCM WAV reader (mono or first channel), used by tests. Walks RIFF chunks. */
export function decodeWav16(buf: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const v = new DataView(buf)
  const tag = (off: number) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a RIFF/WAVE file')
  let sampleRate = 0
  let channels = 1
  let bits = 0
  let off = 12
  while (off + 8 <= v.byteLength) {
    const id = tag(off)
    const size = v.getUint32(off + 4, true)
    const body = off + 8
    if (id === 'fmt ') {
      channels = v.getUint16(body + 2, true)
      sampleRate = v.getUint32(body + 4, true)
      bits = v.getUint16(body + 14, true)
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`Only 16-bit PCM supported, got ${bits}-bit`)
      const frames = Math.floor(size / (2 * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) samples[i] = v.getInt16(body + i * 2 * channels, true) / 32767
      return { samples, sampleRate }
    }
    off = body + size + (size % 2)
  }
  throw new Error('WAV file has no data chunk')
}
