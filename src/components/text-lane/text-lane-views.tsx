import { motion } from 'motion/react'
import { useMemo } from 'react'
import { HEADER_BITS } from '../../dsp/bit-lane'
import { useElementWidth } from '../charts/use-element-width'
import { cn } from '../ui/primitives'

const hex = (b: number) => b.toString(16).padStart(2, '0')

const SEGMENTS = [
  { label: 'salt', bytes: 16, cls: 'bg-amber-400/20 text-amber-200 ring-amber-400/40' },
  { label: 'IV', bytes: 12, cls: 'bg-violet-400/20 text-violet-200 ring-violet-400/40' },
  { label: 'ciphertext', bytes: -1, cls: 'bg-cyan-400/15 text-cyan-200 ring-cyan-400/40' },
  { label: 'GCM tag', bytes: 16, cls: 'bg-rose-400/20 text-rose-200 ring-rose-400/40' },
] as const

/** The encrypted frame byte by byte: salt | IV | ciphertext | tag. */
export function CipherFrameView({ cipher, plaintext }: { cipher: Uint8Array; plaintext: string }) {
  const ctLen = cipher.length - 16 - 12 - 16
  let offset = 0
  const parts = SEGMENTS.map((seg) => {
    const len = seg.bytes === -1 ? ctLen : seg.bytes
    const bytes = Array.from(cipher.slice(offset, offset + len))
    offset += len
    return { ...seg, bytes }
  })
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">plaintext ({new TextEncoder().encode(plaintext).length} bytes UTF-8)</div>
        <div className="font-mono text-sm text-slate-100">{plaintext}</div>
      </div>
      <div className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-wider text-slate-500">
          encrypted frame ({cipher.length} bytes)
          {parts.map((p) => (
            <span key={p.label} className={cn('rounded px-1.5 py-0.5 normal-case tracking-normal ring-1', p.cls)}>
              {p.label} · {p.bytes.length}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-[3px] font-mono text-[10px]">
          {parts.flatMap((p) =>
            p.bytes.map((b, i) => (
              <span key={`${p.label}${i}`} className={cn('rounded px-1 py-0.5 ring-1', p.cls)}>
                {hex(b)}
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  )
}

/** Bitstream as squares; header bits are outlined, bit errors (vs `reference`) turn red. */
export function BitGrid({ bits, reference, max = 1400, title }: { bits: Uint8Array; reference?: Uint8Array | null; max?: number; title?: string }) {
  const shown = Math.min(bits.length, max)
  return (
    <div className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>{title ?? 'Bitstream'} — first {shown} of {bits.length} bits</span>
        <span className="flex items-center gap-3">
          <Legend cls="bg-cyan-300" label="1" />
          <Legend cls="bg-slate-700" label="0" />
          <Legend cls="bg-slate-700 ring-1 ring-amber-300" label="header" />
          {reference && <Legend cls="bg-rose-500" label="bit error" />}
        </span>
      </div>
      <div className="flex flex-wrap gap-[2px]">
        {Array.from({ length: shown }, (_, i) => {
          const wrong = reference && i < reference.length && reference[i] !== bits[i]
          return (
            <motion.span
              key={i}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.002, 0.8) }}
              title={`bit ${i}: ${bits[i]}${wrong ? ` (sent ${reference![i]})` : ''}`}
              className={cn(
                'size-2.5 rounded-[2px]',
                wrong ? 'bg-rose-500' : bits[i] ? 'bg-cyan-300' : 'bg-slate-700',
                i < HEADER_BITS && 'ring-1 ring-amber-300/80',
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block size-2.5 rounded-[2px]', cls)} />
      {label}
    </span>
  )
}

/** Despread BPSK symbols on the complex plane: bit 0 clusters at +1, bit 1 at −1. */
export function ConstellationPlot({ re, im, height = 240 }: { re: Float32Array; im: Float32Array; height?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(360)
  const lim = useMemo(() => {
    let m = 1.6
    for (let i = 0; i < re.length; i++) m = Math.max(m, Math.abs(re[i]) * 1.1, Math.abs(im[i]) * 1.1)
    return Math.min(m, 6)
  }, [re, im])
  const size = Math.min(width, height)
  const pad = 22
  const sx = (v: number) => pad + ((v + lim) / (2 * lim)) * (size - 2 * pad)
  const sy = (v: number) => size - pad - ((v + lim) / (2 * lim)) * (size - 2 * pad)
  return (
    <div ref={ref} className="flex w-full justify-center">
      <svg width={size} height={size}>
        <rect x={sx(0)} y={pad} width={sx(lim) - sx(0)} height={size - 2 * pad} fill="rgba(34,211,238,0.06)" />
        <rect x={pad} y={pad} width={sx(0) - pad} height={size - 2 * pad} fill="rgba(167,139,250,0.06)" />
        <line x1={pad} x2={size - pad} y1={sy(0)} y2={sy(0)} stroke="rgba(148,163,184,0.35)" />
        <line x1={sx(0)} x2={sx(0)} y1={pad} y2={size - pad} stroke="#fbbf24" strokeDasharray="4 3" />
        {[-1, 1].map((v) => (
          <g key={v}>
            <circle cx={sx(v)} cy={sy(0)} r={7} fill="none" stroke="white" strokeOpacity={0.5} />
            <text x={sx(v)} y={sy(0) + 22} textAnchor="middle" className="fill-slate-400 font-mono text-[10px]">
              {v > 0 ? '+1 → bit 0' : '−1 → bit 1'}
            </text>
          </g>
        ))}
        {Array.from(re, (r, i) => (
          <circle key={i} cx={sx(r)} cy={sy(im[i])} r={1.8} fill={r >= 0 ? '#22d3ee' : '#a78bfa'} opacity={0.75} />
        ))}
        <text x={size - pad} y={sy(0) - 6} textAnchor="end" className="fill-slate-500 text-[10px]">
          Re
        </text>
        <text x={sx(0) + 6} y={pad + 10} className="fill-slate-500 text-[10px]">
          Im · decision boundary
        </text>
      </svg>
    </div>
  )
}
