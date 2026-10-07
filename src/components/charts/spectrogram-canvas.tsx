import * as d3 from 'd3'
import { useEffect, useMemo, useRef } from 'react'
import type { Spectrogram } from '../../dsp/analysis'

interface SpectrogramProps {
  spec: Spectrogram
  title?: string
  height?: number
  /** Top of the colour scale in dB; share it between plots to compare them fairly. */
  dbMax?: number
  dbRange?: number
  /** Horizontal guide lines, in Hz. */
  marks?: { hz: number; label: string; color: string }[]
}

const LUT = Array.from({ length: 256 }, (_, i) => d3.rgb(d3.interpolateMagma(i / 255)))

export function specMax(spec: Spectrogram): number {
  let m = -Infinity
  for (let i = 0; i < spec.db.length; i++) if (spec.db[i] > m) m = spec.db[i]
  return m
}

export function SpectrogramCanvas({ spec, title, height = 180, dbMax, dbRange = 85, marks = [] }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const top = useMemo(() => dbMax ?? specMax(spec), [spec, dbMax])
  const nyquist = spec.sampleRate / 2

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = spec.cols
    canvas.height = spec.bins
    const img = ctx.createImageData(spec.cols, spec.bins)
    const lo = top - dbRange
    for (let c = 0; c < spec.cols; c++) {
      for (let b = 0; b < spec.bins; b++) {
        const v = (spec.db[c * spec.bins + b] - lo) / dbRange
        const col = LUT[Math.max(0, Math.min(255, Math.round(v * 255)))]
        const row = spec.bins - 1 - b // low frequencies at the bottom
        const p = (row * spec.cols + c) * 4
        img.data[p] = col.r
        img.data[p + 1] = col.g
        img.data[p + 2] = col.b
        img.data[p + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [spec, top, dbRange])

  const ticks = [0, 5000, 10000, 15000, 20000].filter((t) => t <= nyquist)

  return (
    <div>
      {title && <div className="mb-1.5 text-xs font-medium text-slate-300">{title}</div>}
      <div className="flex gap-1.5">
        <div className="relative w-7 shrink-0 font-mono text-[9px] text-slate-500" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / nyquist) * 100}%` }}>
              {t / 1000}k
            </span>
          ))}
        </div>
        <div className="relative grow overflow-hidden rounded-lg ring-1 ring-white/10" style={{ height }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {marks.map((m) => (
            <div
              key={m.label}
              className="absolute inset-x-0 border-t border-dashed"
              style={{ top: `${(1 - m.hz / nyquist) * 100}%`, borderColor: m.color }}
            >
              <span className="absolute right-1 -top-4 rounded bg-black/60 px-1 text-[9px] font-semibold" style={{ color: m.color }}>
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="ml-8 mt-1 flex justify-between font-mono text-[9px] text-slate-500">
        <span>0 s</span>
        <span>{spec.duration.toFixed(1)} s</span>
      </div>
    </div>
  )
}
