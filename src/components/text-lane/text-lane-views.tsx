import { useMemo } from 'react'
import { HEADER_BITS } from '../../dsp/bit-lane'
import { useElementWidth } from '../charts/use-element-width'
import { cn } from '../ui/primitives'

const hex = (b: number) => b.toString(16).padStart(2, '0')

const SEGMENTS = [
  { label: 'salt', bytes: 16, cls: 'text-warn' },
  { label: 'IV', bytes: 12, cls: 'text-blue' },
  { label: 'ciphertext', bytes: -1, cls: 'text-teal' },
  { label: 'GCM tag', bytes: 16, cls: 'text-ok' },
] as const

/** The encrypted frame byte by byte: salt | IV | ciphertext | tag. */
export function CipherFrameView({ cipher, plaintext }: { cipher: Uint8Array; plaintext: string }) {
  if (cipher.length === 0) return <p className="text-[13px] text-fg-3">No ciphertext was produced.</p>
  const ctLen = cipher.length - 16 - 12 - 16
  let offset = 0
  const parts = SEGMENTS.map((seg) => {
    const len = seg.bytes === -1 ? ctLen : seg.bytes
    const bytes = Array.from(cipher.slice(offset, offset + len))
    offset += len
    return { ...seg, bytes }
  })
  return (
    <div className="space-y-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">plaintext · {new TextEncoder().encode(plaintext).length} bytes UTF-8</div>
        <div className="mt-1 break-words font-mono text-[13px] text-fg">{plaintext || <span className="text-fg-3">(empty — key-verification token for a voice payload)</span>}</div>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">
          <span>encrypted frame · {cipher.length} bytes</span>
          {parts.map((p) => (
            <span key={p.label} className={p.cls}>
              ■ {p.label} {p.bytes.length}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-[6px] gap-y-0.5 font-mono text-[11px] leading-5">
          {parts.flatMap((p) =>
            p.bytes.map((b, i) => (
              <span key={`${p.label}${i}`} className={p.cls}>
                {hex(b)}
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  )
}

/** Bitstream as squares; header bits are underlined, bit errors (vs `reference`) turn red. */
export function BitGrid({ bits, reference, max = 1400, title }: { bits: Uint8Array; reference?: Uint8Array | null; max?: number; title?: string }) {
  const shown = Math.min(bits.length, max)
  let errors = 0
  if (reference) for (let i = 0; i < shown && i < reference.length; i++) if (reference[i] !== bits[i]) errors++
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">
        <span>
          {title ?? 'Bitstream'} · {shown === bits.length ? `${bits.length} bits` : `first ${shown} of ${bits.length} bits`}
        </span>
        <span className="flex items-center gap-3">
          <Legend cls="bg-teal" label="1" />
          <Legend cls="bg-line-2" label="0" />
          <Legend cls="bg-line-2 outline outline-1 outline-warn" label="header" />
          {reference && <Legend cls="bg-err" label={`error (${errors})`} />}
        </span>
      </div>
      <div className="flex flex-wrap gap-[2px]" role="img" aria-label={`${shown} bits${reference ? `, ${errors} differ from what was sent` : ''}`}>
        {Array.from({ length: shown }, (_, i) => {
          const wrong = reference && i < reference.length && reference[i] !== bits[i]
          return <span key={i} className={cn('size-2', wrong ? 'bg-err' : bits[i] ? 'bg-teal' : 'bg-line-2', i < HEADER_BITS && 'outline outline-1 outline-warn/70')} />
        })}
      </div>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-block size-2', cls)} />
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
  const size = Math.max(160, Math.min(width, height))
  const pad = 22
  const sx = (v: number) => pad + ((v + lim) / (2 * lim)) * (size - 2 * pad)
  const sy = (v: number) => size - pad - ((v + lim) / (2 * lim)) * (size - 2 * pad)
  return (
    <div ref={ref} className="flex w-full justify-center">
      <svg width={size} height={size} role="img" aria-label={`BPSK constellation of ${re.length} despread symbols`}>
        <rect x={pad} y={pad} width={size - 2 * pad} height={size - 2 * pad} fill="none" stroke="var(--color-line)" />
        <line x1={pad} x2={size - pad} y1={sy(0)} y2={sy(0)} stroke="var(--color-line-2)" />
        <line x1={sx(0)} x2={sx(0)} y1={pad} y2={size - pad} stroke="var(--color-warn)" strokeDasharray="3 3" />
        {[-1, 1].map((v) => (
          <g key={v}>
            <circle cx={sx(v)} cy={sy(0)} r={6} fill="none" stroke="var(--color-fg-2)" strokeOpacity={0.6} />
            <text x={sx(v)} y={sy(0) + 20} textAnchor="middle" className="fill-fg-3 font-mono text-[10px]">
              {v > 0 ? '+1 → 0' : '−1 → 1'}
            </text>
          </g>
        ))}
        {Array.from(re, (r, i) => (
          <circle key={i} cx={sx(r)} cy={sy(im[i])} r={1.6} fill={r >= 0 ? 'var(--color-teal)' : 'var(--color-blue)'} opacity={0.8} />
        ))}
        <text x={size - pad - 2} y={sy(0) - 5} textAnchor="end" className="fill-fg-3 font-mono text-[10px]">
          Re
        </text>
        <text x={sx(0) + 5} y={pad + 11} className="fill-fg-3 font-mono text-[10px]">
          Im · decision
        </text>
      </svg>
    </div>
  )
}
