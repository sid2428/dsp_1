import { AnimatePresence, motion } from 'motion/react'
import type { StageTiming } from '../../worker/protocol'
import { cn, fmtMs } from '../ui/primitives'

interface ProcessLogProps<S extends string> {
  order: S[]
  labels: Record<S, string>
  log: StageTiming<S>[]
  running: boolean
  failed?: boolean
}

/** The worker's own record of what ran and how long it took; pending rows are shown as pending, never guessed. */
export function ProcessLog<S extends string>({ order, labels, log, running, failed }: ProcessLogProps<S>) {
  const times = new Map(log.map((t) => [t.stage, t.ms]))
  const firstPending = order.find((s) => !times.has(s))
  const total = log.reduce((a, t) => a + t.ms, 0)
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">
        <span>Process log</span>
        <span className={cn(running ? 'text-blue' : failed ? 'text-err' : log.length ? 'text-ok' : '')}>
          {running ? 'running' : failed ? 'failed' : log.length ? `${fmtMs(total)} ms` : 'idle'}
        </span>
      </div>
      <ol className="mt-2" aria-live="polite">
        {order.map((s) => {
          const ms = times.get(s)
          const live = running && s === firstPending
          const broke = failed && s === firstPending
          return (
            <li key={s} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
              <span className={cn('flex items-baseline gap-2 text-[12px]', ms !== undefined ? 'text-fg' : live ? 'text-blue' : broke ? 'text-err' : 'text-fg-3')}>
                <span className="font-mono text-[10px]">{ms !== undefined ? '■' : live ? <span className="rec-blink">■</span> : '□'}</span>
                {labels[s]}
              </span>
              <AnimatePresence initial={false}>
                {ms !== undefined ? (
                  <motion.span key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-mono text-[11px] text-fg-2">
                    {fmtMs(ms)} ms
                  </motion.span>
                ) : (
                  <span className="font-mono text-[11px] text-fg-3">{live ? '…' : broke ? 'error' : '—'}</span>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
