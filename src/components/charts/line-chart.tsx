import { scaleLinear } from 'd3-scale'
import { area as d3area, line as d3line } from 'd3-shape'
import { useId, useMemo, useState, type PointerEvent } from 'react'
import { useElementWidth } from './use-element-width'

export interface ChartSeries {
  x: Float32Array
  y: Float32Array
  color: string
  label: string
  dashed?: boolean
}

export interface ChartBand {
  from: number
  to: number
  color: string
  label: string
}

interface LineChartProps {
  series: ChartSeries[]
  bands?: ChartBand[]
  xDomain: [number, number]
  /** Defaults to [max - range, max + 5] over the visible data. */
  yDomain?: [number, number]
  yRange?: number
  height?: number
  xLabel?: string
  yLabel?: string
  xFormat?: (v: number) => string
  /** Formats the hover readout of x (defaults to kHz with two decimals). */
  xReadout?: (v: number) => string
  yUnit?: string
  fill?: boolean
  xTicks?: number
  yTicks?: number
  strokeWidth?: number
  /** Accessible summary of what the chart shows. */
  ariaLabel?: string
}

const M = { top: 36, right: 14, bottom: 34, left: 48 }

/** Max-pools a series into ~one point per pixel so 100k-point spectra stay cheap to draw. */
function pool(x: Float32Array, y: Float32Array, domain: [number, number], buckets: number): [number, number][] {
  const out: [number, number][] = []
  const [x0, x1] = domain
  const span = x1 - x0
  let cur = -1
  let best = -Infinity
  let bestX = 0
  for (let i = 0; i < x.length; i++) {
    if (x[i] < x0 || x[i] > x1) continue
    const b = Math.min(buckets - 1, Math.floor(((x[i] - x0) / span) * buckets))
    if (b !== cur) {
      if (cur >= 0) out.push([bestX, best])
      cur = b
      best = -Infinity
    }
    if (y[i] > best) {
      best = y[i]
      bestX = x[i]
    }
  }
  if (cur >= 0) out.push([bestX, best])
  return out
}

/** Index of the sample nearest to `v` in an ascending array. */
function nearest(x: Float32Array, v: number): number {
  let lo = 0
  let hi = x.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (x[mid] < v) lo = mid
    else hi = mid
  }
  return Math.abs(x[lo] - v) <= Math.abs(x[hi] - v) ? lo : hi
}

export function LineChart({
  series,
  bands = [],
  xDomain,
  yDomain,
  yRange = 90,
  height = 220,
  xLabel = 'Frequency (kHz)',
  yLabel = 'dB',
  xFormat = (v) => (v / 1000).toFixed(0),
  xReadout = (v) => `${(v / 1000).toFixed(2)} kHz`,
  yUnit = 'dB',
  fill = false,
  xTicks = 8,
  yTicks = 5,
  strokeWidth = 1.4,
  ariaLabel,
}: LineChartProps) {
  const gradientId = useId()
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const innerW = Math.max(50, width - M.left - M.right)
  const innerH = height - M.top - M.bottom

  const pooled = useMemo(() => series.map((s) => pool(s.x, s.y, xDomain, Math.max(50, Math.floor(innerW)))), [series, xDomain, innerW])

  const yDom = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain
    let max = -Infinity
    pooled.forEach((pts) => pts.forEach(([, v]) => (max = Math.max(max, v))))
    if (!Number.isFinite(max)) max = 0
    return [Math.floor((max - yRange) / 10) * 10, Math.ceil((max + 5) / 10) * 10]
  }, [pooled, yDomain, yRange])

  const xs = scaleLinear().domain(xDomain).range([0, innerW])
  const ys = scaleLinear().domain(yDom).range([innerH, 0]).clamp(true)
  const line = d3line<[number, number]>()
    .x((d) => xs(d[0]))
    .y((d) => ys(d[1]))
  const area = d3area<[number, number]>()
    .x((d) => xs(d[0]))
    .y0(innerH)
    .y1((d) => ys(d[1]))

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = Math.max(0, Math.min(innerW, e.clientX - rect.left))
    setHoverX(xs.invert(px))
  }

  const readout =
    hoverX === null
      ? null
      : series.map((s) => {
          const i = nearest(s.x, hoverX)
          return { label: s.label, color: s.color, x: s.x[i], y: s.y[i] }
        })
  const readX = readout?.[readout.length - 1]?.x ?? hoverX

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {fill && (
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.label} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
        )}
        <g transform={`translate(${M.left},${M.top})`}>
          {bands.map((b) => {
            const x0 = xs(Math.max(b.from, xDomain[0]))
            const x1 = xs(Math.min(b.to, xDomain[1]))
            if (x1 <= x0) return null
            return (
              <g key={b.label}>
                <rect x={x0} width={x1 - x0} y={0} height={innerH} fill={b.color} opacity={0.07} />
                <line x1={x0} x2={x0} y1={-8} y2={innerH} stroke={b.color} strokeOpacity={0.5} />
                <line x1={x1} x2={x1} y1={-8} y2={innerH} stroke={b.color} strokeOpacity={0.5} />
                <line x1={x0} x2={x1} y1={-8} y2={-8} stroke={b.color} strokeOpacity={0.5} />
                {x1 - x0 > 34 && (
                  <text x={x0 + 4} y={-12} className="font-mono text-[10px]" fill={b.color}>
                    {b.label}
                  </text>
                )}
              </g>
            )
          })}
          {ys.ticks(yTicks).map((t) => (
            <g key={`y${t}`}>
              <line x1={0} x2={innerW} y1={ys(t)} y2={ys(t)} stroke="var(--color-line)" />
              <text x={-8} y={ys(t)} dy="0.32em" textAnchor="end" className="fill-fg-3 font-mono text-[10px]">
                {String(t).replace('-', '−')}
              </text>
            </g>
          ))}
          {xs.ticks(xTicks).map((t) => (
            <g key={`x${t}`}>
              <line x1={xs(t)} x2={xs(t)} y1={innerH} y2={innerH + 4} stroke="var(--color-line-2)" />
              <text x={xs(t)} y={innerH + 16} textAnchor="middle" className="fill-fg-3 font-mono text-[10px]">
                {xFormat(t)}
              </text>
            </g>
          ))}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--color-line-2)" />
          {fill &&
            pooled.map((pts, i) =>
              series[i].dashed ? null : <path key={`fill-${series[i].label}`} d={area(pts) ?? ''} fill={`url(#${gradientId}-${i})`} stroke="none" />,
            )}
          {pooled.map((pts, i) => (
            <path
              key={series[i].label}
              d={line(pts) ?? ''}
              fill="none"
              stroke={series[i].color}
              strokeWidth={series[i].dashed ? 1 : strokeWidth}
              strokeDasharray={series[i].dashed ? '3 3' : undefined}
              strokeLinejoin="round"
            />
          ))}
          {readout && readX !== null && (
            <g pointerEvents="none">
              <line x1={xs(readX)} x2={xs(readX)} y1={0} y2={innerH} stroke="var(--color-fg-2)" strokeWidth={1} />
              {readout.map((r) => (
                <rect key={r.label} x={xs(r.x) - 2.5} y={ys(r.y) - 2.5} width={5} height={5} fill={r.color} />
              ))}
            </g>
          )}
          <text x={innerW} y={innerH + 30} textAnchor="end" className="fill-fg-3 font-mono text-[10px]">
            {xLabel}
          </text>
          <text x={-M.left + 2} y={-26} className="fill-fg-3 font-mono text-[10px]">
            {yLabel}
          </text>
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHoverX(null)}
            style={{ touchAction: 'pan-y' }}
          />
        </g>
      </svg>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-5 gap-y-1 pl-12 font-mono text-[11px] text-fg-2" aria-live="off">
        {readout && readX !== null ? (
          <>
            <span className="text-fg">{xReadout(readX)}</span>
            {readout.map((r) => (
              <span key={r.label} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3" style={{ background: r.color }} />
                {r.label} <span className="text-fg">{r.y.toFixed(1).replace('-', '−')}</span> {yUnit}
              </span>
            ))}
          </>
        ) : (
          series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 border-t" style={{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }} />
              {s.label}
            </span>
          ))
        )}
      </div>
    </div>
  )
}
