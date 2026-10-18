import { motion } from 'motion/react'
import { cn } from '../ui/primitives'

export type NodeState = 'idle' | 'running' | 'done' | 'active' | 'off'

export interface DiagramNode {
  id: string
  label: string
  sub: string
  /** Column and row on the schematic grid. */
  col: number
  row: number
  /** Rows spanned (e.g. the shared two-for-one FFT). */
  span?: number
  kind?: 'io' | 'op' | 'fft' | 'sum'
}

export interface DiagramEdge {
  from: string
  to: string
  /** Side of the target the wire enters (default: left). */
  enter?: 'left' | 'top' | 'bottom'
  /** Row offset inside a spanning source/target, so two wires leave a tall block at different heights. */
  fromRow?: number
  toRow?: number
}

interface SignalDiagramProps {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  states: Record<string, NodeState>
  onSelect?: (id: string) => void
  rows: number
  cols: number
  /** Accessible name for the whole schematic. */
  label: string
}

const CW = 150
const RH = 100
const NW = 130
const NH = 52
const PAD = 14

const pos = (n: DiagramNode) => ({ x: PAD + n.col * CW, y: PAD + n.row * RH, w: NW, h: NH + ((n.span ?? 1) - 1) * RH })

const STROKE: Record<NodeState, string> = {
  idle: 'var(--color-line-2)',
  running: 'var(--color-blue)',
  done: 'var(--color-teal-dim)',
  active: 'var(--color-teal)',
  off: 'var(--color-line)',
}
const FILL: Record<NodeState, string> = {
  idle: 'rgba(16,40,58,0.35)',
  running: 'rgba(78,165,255,0.12)',
  done: 'rgba(16,40,58,0.9)',
  active: 'rgba(32,214,199,0.14)',
  off: 'rgba(7,21,34,0.6)',
}

/**
 * Orthogonal schematic of a processing chain. Every visual state is passed in: the diagram never animates
 * on its own, so what lights up is always what the worker has actually done or what the walkthrough shows.
 */
export function SignalDiagram({ nodes, edges, states, onSelect, rows, cols, label }: SignalDiagramProps) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const width = PAD * 2 + (cols - 1) * CW + NW
  const height = PAD * 2 + (rows - 1) * RH + NH

  const wire = (e: DiagramEdge) => {
    const a = byId.get(e.from)!
    const b = byId.get(e.to)!
    const pa = pos(a)
    const pb = pos(b)
    const ay = pa.y + (e.fromRow ?? 0) * RH + NH / 2
    const sx = pa.x + pa.w
    if (e.enter === 'top' || e.enter === 'bottom') {
      const tx = pb.x + pb.w / 2
      const ty = e.enter === 'top' ? pb.y : pb.y + pb.h
      return `M${sx},${ay} H${tx} V${ty}`
    }
    const by = pb.y + (e.toRow ?? 0) * RH + NH / 2
    const tx = pb.x
    if (Math.abs(ay - by) < 1) return `M${sx},${ay} H${tx}`
    const mx = sx + (tx - sx) / 2
    return `M${sx},${ay} H${mx} V${by} H${tx}`
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label} className="block h-auto w-full min-w-[920px]">
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-line-2)" />
          </marker>
          <marker id="arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-teal)" />
          </marker>
        </defs>

        {edges.map((e) => {
          const sa = states[e.from] ?? 'idle'
          const sb = states[e.to] ?? 'idle'
          const off = sa === 'off' || sb === 'off'
          const lit = !off && (sa === 'done' || sa === 'active') && (sb === 'done' || sb === 'active' || sb === 'running')
          const flowing = !off && (sb === 'active' || sb === 'running')
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={wire(e)}
              fill="none"
              stroke={off ? 'var(--color-line)' : lit ? 'var(--color-teal)' : 'var(--color-line-2)'}
              strokeOpacity={off ? 0.6 : lit ? (flowing ? 1 : 0.55) : 1}
              strokeWidth={flowing ? 1.6 : 1}
              strokeDasharray={off ? '2 4' : undefined}
              className={flowing ? 'wire-flow' : undefined}
              markerEnd={lit ? 'url(#arrow-lit)' : 'url(#arrow)'}
            />
          )
        })}

        {nodes.map((n) => {
          const p = pos(n)
          const st = states[n.id] ?? 'idle'
          const clickable = !!onSelect && st !== 'off'
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? `${n.label}: ${n.sub}${st === 'active' ? ' (selected)' : ''}` : undefined}
              aria-pressed={clickable ? st === 'active' : undefined}
              onClick={clickable ? () => onSelect(n.id) : undefined}
              onKeyDown={
                clickable
                  ? (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        onSelect(n.id)
                      }
                    }
                  : undefined
              }
              className={cn(clickable && 'cursor-pointer outline-none [&:focus-visible>rect]:stroke-fg')}
            >
              <motion.rect
                width={p.w}
                height={p.h}
                rx={n.kind === 'sum' ? p.h / 2 : 2}
                initial={false}
                animate={{ fill: FILL[st], stroke: STROKE[st] }}
                transition={{ duration: 0.35 }}
                strokeWidth={st === 'active' ? 1.6 : 1}
                strokeDasharray={st === 'off' ? '3 3' : undefined}
              />
              {n.kind === 'fft' && <line x1={8} x2={p.w - 8} y1={p.h - 10} y2={p.h - 10} stroke={STROKE[st]} strokeOpacity={0.5} />}
              {st === 'running' && (
                <motion.rect
                  width={3}
                  height={p.h}
                  fill="var(--color-blue)"
                  initial={{ x: 0, opacity: 0.9 }}
                  animate={{ x: p.w - 3 }}
                  transition={{ duration: 0.8, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
                />
              )}
              <text x={10} y={22} className="font-sans text-[15px]" fill={st === 'off' ? 'var(--color-fg-3)' : 'var(--color-fg)'}>
                {n.label}
              </text>
              <text x={10} y={40} className="font-mono text-[11.5px]" fill={st === 'active' ? 'var(--color-teal)' : 'var(--color-fg-3)'}>
                {n.sub}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
