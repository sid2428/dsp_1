import { motion } from 'motion/react'
import { useMemo } from 'react'
import { bitReverse, log2Int, type ButterflyEvent, type ButterflyTrace } from '../../dsp/fft'
import { useElementWidth } from '../charts/use-element-width'

export function fmtComplex(re: number, im: number, digits = 2): string {
  const r = Math.abs(re) < 5e-4 ? 0 : re
  const i = Math.abs(im) < 5e-4 ? 0 : im
  return `${r.toFixed(digits)}${i < 0 ? '−' : '+'}${Math.abs(i).toFixed(digits)}j`
}

const bin = (v: number, bits: number) => v.toString(2).padStart(bits, '0')

interface ButterflyDiagramProps {
  trace: ButterflyTrace
  /** Number of butterflies already executed (0 … N/2·log2N). */
  cursor: number
  onPick?: (flatIndex: number) => void
}

export interface FlatButterfly extends ButterflyEvent {
  flat: number
}

export function flatten(trace: ButterflyTrace): FlatButterfly[] {
  const out: FlatButterfly[] = []
  trace.butterflies.forEach((stage) => stage.forEach((b) => out.push({ ...b, flat: out.length })))
  return out
}

export function ButterflyDiagram({ trace, cursor, onPick }: ButterflyDiagramProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(900)
  const { n, kind } = trace
  const bits = log2Int(n)
  const flat = useMemo(() => flatten(trace), [trace])
  const showValues = n <= 8

  const rowH = n <= 8 ? 54 : 30
  const top = n <= 8 ? 52 : 40
  const height = top + (n - 1) * rowH + 30
  const leftW = 118
  const rightW = 118
  const cols = bits + 1
  const colX = (c: number) => leftW + (c * (width - leftW - rightW)) / (cols - 1)
  const rowY = (i: number) => top + i * rowH

  // which flat butterfly writes slot j in stage s (so column s+1 reveals progressively)
  const writer = useMemo(() => {
    const w: number[][] = Array.from({ length: bits }, () => new Array<number>(n).fill(0))
    flat.forEach((b) => {
      w[b.stage][b.top] = b.flat
      w[b.stage][b.bottom] = b.flat
    })
    return w
  }, [flat, bits, n])

  const current = cursor < flat.length ? flat[cursor] : null
  const revealed = (col: number, slot: number) => col === 0 || writer[col - 1][slot] < cursor

  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <svg width={width} height={height} className="min-w-[640px] select-none">
        {/* stage headers */}
        {Array.from({ length: bits }, (_, s) => {
          const active = current?.stage === s
          const span = kind === 'dit' ? 2 ** s : n / 2 ** (s + 1)
          return (
            <g key={`h${s}`}>
              <rect
                x={colX(s) + 6}
                y={2}
                width={colX(s + 1) - colX(s) - 12}
                height={20}
                rx={6}
                fill={active ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.03)'}
                stroke={active ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.08)'}
              />
              <text x={(colX(s) + colX(s + 1)) / 2} y={16} textAnchor="middle" className="fill-slate-300 text-[10px] font-semibold">
                Stage {s + 1} · span {span}
              </text>
            </g>
          )
        })}

        {/* butterfly wires */}
        {flat.map((b) => {
          const x0 = colX(b.stage)
          const x1 = colX(b.stage + 1)
          const done = b.flat < cursor
          const isCur = current?.flat === b.flat
          const stroke = isCur ? '#fbbf24' : done ? 'rgba(34,211,238,0.55)' : 'rgba(148,163,184,0.18)'
          const sw = isCur ? 2.4 : 1.2
          const yt = rowY(b.top)
          const yb = rowY(b.bottom)
          // twiddle sits on the lower wing: before the cross for DIT, after it for DIF (labels go below the wire)
          const twX = kind === 'dit' ? x0 + 40 : x1 - 30
          const minusX = kind === 'dit' ? x1 - 14 : x1 - 62
          return (
            <g key={`b${b.flat}`} onClick={() => onPick?.(b.flat)} className="cursor-pointer">
              <line x1={x0} y1={yt} x2={x1} y2={yt} stroke={stroke} strokeWidth={sw} />
              <line x1={x0} y1={yb} x2={x1} y2={yb} stroke={stroke} strokeWidth={sw} />
              <line x1={x0} y1={yt} x2={x1} y2={yb} stroke={stroke} strokeWidth={sw} />
              <line x1={x0} y1={yb} x2={x1} y2={yt} stroke={stroke} strokeWidth={sw} />
              {(isCur || n <= 8) && (
                <text x={twX} y={yb + 14} textAnchor="middle" className="font-mono text-[9px]" fill={isCur ? '#fbbf24' : '#a78bfa'}>
                  W{b.k === 0 ? '⁰' : ''}
                  <tspan fontSize="7" dy="-4">
                    {b.k === 0 ? '' : `${b.k}`}
                  </tspan>
                </text>
              )}
              {isCur && (
                <text x={minusX} y={yb + 14} textAnchor="middle" className="font-mono text-[9px]" fill="#fb7185">
                  −1
                </text>
              )}
              {isCur && (
                <motion.circle
                  key={`pulse${b.flat}`}
                  r={4}
                  fill="#fbbf24"
                  initial={{ cx: x0, cy: yt }}
                  animate={{ cx: x1, cy: yb }}
                  transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </g>
          )
        })}

        {/* nodes + values */}
        {trace.columns.map((col, c) =>
          col.re.map((re, slot) => {
            const shown = revealed(c, slot)
            const inCur = current && (slot === current.top || slot === current.bottom) && (c === current.stage || c === current.stage + 1)
            return (
              <g key={`n${c}-${slot}`}>
                <circle
                  cx={colX(c)}
                  cy={rowY(slot)}
                  r={inCur ? 6 : 4.5}
                  fill={shown ? (inCur ? '#fbbf24' : c === cols - 1 ? '#34d399' : '#22d3ee') : '#1e293b'}
                  stroke="rgba(0,0,0,0.6)"
                >
                  <title>{shown ? fmtComplex(re, col.im[slot], 4) : 'not computed yet'}</title>
                </circle>
                {showValues && shown && (
                  <text x={colX(c)} y={rowY(slot) - 9} textAnchor="middle" className="fill-slate-400 font-mono text-[8.5px]">
                    {fmtComplex(re, col.im[slot])}
                  </text>
                )}
              </g>
            )
          }),
        )}

        {/* input labels */}
        {trace.inputOrder.map((idx, slot) => (
          <text key={`in${slot}`} x={leftW - 14} y={rowY(slot)} dy="0.32em" textAnchor="end" className="font-mono text-[10px]">
            <tspan className="fill-slate-200">x[{idx}]</tspan>
            {kind === 'dit' && <tspan className="fill-slate-500"> {bin(slot, bits)}→{bin(idx, bits)}</tspan>}
          </text>
        ))}
        {/* output labels */}
        {trace.outputOrder.map((k, slot) => (
          <text key={`out${slot}`} x={width - rightW + 14} y={rowY(slot)} dy="0.32em" className="font-mono text-[10px]">
            <tspan className="fill-emerald-300">X[{k}]</tspan>
            {kind === 'dif' && <tspan className="fill-slate-500"> {bin(slot, bits)}→{bin(bitReverse(slot, bits), bits)}</tspan>}
          </text>
        ))}
      </svg>
    </div>
  )
}
