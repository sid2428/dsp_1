import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from '../ui/primitives'

export interface Walkthrough {
  index: number
  playing: boolean
  count: number
  go: (i: number) => void
  next: () => void
  prev: () => void
  toggle: () => void
  replay: () => void
}

/**
 * Step cursor for a block-diagram tour. Starts paused unless `autoplay` (never for reduced motion),
 * auto-advances only while playing and stops at the last step. `resetKey` restarts it (e.g. a new result).
 */
export function useWalkthrough(count: number, resetKey: unknown, { intervalMs = 3200, autoplay = false } = {}): Walkthrough {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(autoplay && !reduce)

  useEffect(() => {
    setIndex(0)
    setPlaying(autoplay && !reduce)
  }, [resetKey, reduce, autoplay])

  useEffect(() => {
    if (!playing) return
    if (index >= count - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex((i) => Math.min(count - 1, i + 1)), intervalMs)
    return () => clearTimeout(t)
  }, [playing, index, count, intervalMs])

  const go = useCallback((i: number) => {
    setPlaying(false)
    setIndex(Math.max(0, Math.min(count - 1, i)))
  }, [count])

  return {
    index,
    playing,
    count,
    go,
    next: () => go(index + 1),
    prev: () => go(index - 1),
    toggle: () => {
      if (playing) setPlaying(false)
      else {
        if (index >= count - 1) setIndex(0)
        setPlaying(true)
      }
    },
    replay: () => {
      setIndex(0)
      setPlaying(true)
    },
  }
}

function TransportButton({ label, onClick, disabled, children, primary }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-9 place-items-center rounded-[3px] border transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        primary ? 'border-teal text-teal hover:bg-teal/10' : 'border-line-2 text-fg-2 hover:border-fg-3 hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

export function WalkthroughControls({ w, label }: { w: Walkthrough; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-1.5" role="group" aria-label={`${label} controls`}>
        <TransportButton label="Previous step" onClick={w.prev} disabled={w.index === 0}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </TransportButton>
        <TransportButton label={w.playing ? 'Pause' : w.index >= w.count - 1 ? 'Play from the start' : 'Resume'} onClick={w.toggle} primary>
          {w.playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4 translate-x-px" aria-hidden="true" />}
        </TransportButton>
        <TransportButton label="Next step" onClick={w.next} disabled={w.index >= w.count - 1}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </TransportButton>
        <TransportButton label="Replay from the first step" onClick={w.replay}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
        </TransportButton>
      </div>
      <div className="flex min-w-[10rem] grow items-center gap-3">
        <span className="font-mono text-[12px] text-fg">
          {String(w.index + 1).padStart(2, '0')}
          <span className="text-fg-3"> / {String(w.count).padStart(2, '0')}</span>
        </span>
        <div className="flex h-1 grow gap-[3px]" aria-hidden="true">
          {Array.from({ length: w.count }, (_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => w.go(i)}
              className={cn('h-full grow transition-colors', i < w.index ? 'bg-teal-dim' : i === w.index ? 'bg-teal' : 'bg-line-2 hover:bg-fg-3')}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-fg-3">{w.playing ? 'playing' : 'paused'}</span>
      </div>
    </div>
  )
}
