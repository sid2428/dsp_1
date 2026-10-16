import { Download, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { clipToWavBlob, downloadWav } from '../../audio/load-audio'
import { SAMPLE_RATE } from '../../dsp/constants'
import { cn } from '../ui/primitives'

export type WaveColor = 'teal' | 'blue' | 'ok' | 'warn' | 'err' | 'fg'

interface WaveformPlayerProps {
  samples: Float32Array
  label?: string
  /** Normalise loudness for listening (does not change the underlying data). */
  normalize?: boolean
  color?: WaveColor
  height?: number
  downloadName?: string
  compact?: boolean
  /** Small note under the label, e.g. "loudness normalised". */
  note?: string
}

const COLORS: Record<WaveColor, [string, string]> = {
  teal: ['#1f5a63', '#20d6c7'],
  blue: ['#24496f', '#4ea5ff'],
  ok: ['#2f5c4a', '#8fe3b0'],
  warn: ['#5f4d2a', '#f2c46d'],
  err: ['#653535', '#ff8a80'],
  fg: ['#3a5266', '#e7f0f6'],
}

/** Only one player sounds at a time across the whole app. */
let activePlayer: WaveSurfer | null = null

export function WaveformPlayer({ samples, label, normalize, color = 'teal', height = 64, downloadName, compact, note }: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [time, setTime] = useState(0)
  const duration = samples.length / SAMPLE_RATE

  useEffect(() => {
    if (!containerRef.current) return
    const url = URL.createObjectURL(clipToWavBlob(samples, normalize))
    const [wave, progress] = COLORS[color]
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height,
      waveColor: wave,
      progressColor: progress,
      cursorColor: '#e7f0f6',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      normalize: true,
      dragToSeek: true,
    })
    wsRef.current = ws
    setReady(false)
    setPlaying(false)
    setTime(0)
    ws.on('ready', () => setReady(true))
    ws.on('play', () => {
      if (activePlayer && activePlayer !== ws) activePlayer.pause()
      activePlayer = ws
      setPlaying(true)
    })
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    ws.on('timeupdate', (t) => setTime(t))
    ws.load(url).catch(() => {
      /* superseded or destroyed before load finished */
    })
    return () => {
      if (activePlayer === ws) activePlayer = null
      ws.destroy()
      wsRef.current = null
      URL.revokeObjectURL(url)
    }
  }, [samples, normalize, color, height])

  const toggle = () => {
    wsRef.current?.playPause().catch(() => setPlaying(false))
  }

  return (
    <div className={cn('min-w-0', compact ? 'space-y-1.5' : 'space-y-2')}>
      {(label || note) && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-fg">
            {label}
            {note && <span className="ml-2 font-mono text-[11px] text-fg-3">{note}</span>}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-fg-3">
            {time.toFixed(1)} / {duration.toFixed(1)} s
          </span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={`${playing ? 'Pause' : 'Play'}${label ? ` ${label}` : ''}`}
          className={cn(
            'grid shrink-0 place-items-center rounded-[3px] border transition-colors disabled:opacity-40',
            compact ? 'size-8' : 'size-10',
            playing ? 'border-fg bg-fg text-ink' : 'border-line-2 text-fg hover:border-teal hover:text-teal',
          )}
        >
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4 translate-x-px" aria-hidden="true" />}
        </button>
        <div ref={containerRef} className="min-w-0 grow" />
        {downloadName && (
          <button
            type="button"
            onClick={() => downloadWav(samples, downloadName)}
            className="grid size-9 shrink-0 place-items-center rounded-[3px] text-fg-3 transition-colors hover:bg-panel hover:text-fg"
            aria-label={`Download ${downloadName}`}
            title={`Download ${downloadName} (16-bit WAV)`}
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
