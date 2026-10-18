import type { ReactNode } from 'react'
import { cn } from '../ui/primitives'

interface StageFrameProps {
  index: string
  /** The station's role, e.g. "Recording studio". */
  role: string
  title: string
  lead: ReactNode
  /** Live annotations under the lead: status, measured values, the processing log. */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Every stage shares one asymmetric composition: a narrow annotation column that stays in view,
 * and a wide working surface. Hierarchy comes from type and hairlines, not boxes.
 */
export function StageFrame({ index, role, title, lead, aside, children, className }: StageFrameProps) {
  return (
    <div className={cn('grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]', className)}>
      <aside className="min-w-0 lg:sticky lg:top-36 lg:self-start">
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">
          <span className="text-teal">{index}</span>
          <span>{role}</span>
        </div>
        <h1 className="mt-3 text-[28px] font-light leading-[1.1] tracking-[-0.01em] text-fg sm:text-[34px]">{title}</h1>
        <div className="mt-4 text-[14px] leading-relaxed text-fg-2">{lead}</div>
        {aside && <div className="mt-8 space-y-8">{aside}</div>}
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
