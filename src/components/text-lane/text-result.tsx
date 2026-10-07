import { CheckCircle2, ShieldX, Unplug } from 'lucide-react'
import type { TextDecodeInfo, TextLaneInfo } from '../../worker/protocol'
import { Badge, cn, Metric } from '../ui/primitives'
import { BitGrid, ConstellationPlot } from './text-lane-views'

const STATUS = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-300 ring-emerald-400/40 bg-emerald-400/10', label: 'Decrypted and authenticated' },
  'auth-failed': { icon: ShieldX, cls: 'text-rose-300 ring-rose-400/40 bg-rose-400/10', label: 'AES-GCM authentication failed — wrong key or corrupted bits' },
  'no-payload': { icon: Unplug, cls: 'text-amber-300 ring-amber-400/40 bg-amber-400/10', label: 'No text found — header did not sync (wrong key, or no text was sent)' },
} as const

export function TextStatusBanner({ info }: { info: TextDecodeInfo }) {
  const s = STATUS[info.status]
  const Icon = s.icon
  return (
    <div className={cn('flex items-start gap-3 rounded-xl px-4 py-3 ring-1', s.cls)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <div className="text-xs font-semibold">{s.label}</div>
        {info.text !== null && <div className="mt-1 break-words font-mono text-base text-white">{info.text}</div>}
      </div>
    </div>
  )
}

export function TextDecodeStats({ info }: { info: TextDecodeInfo }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Metric label="Bits read" value={info.bits.length.toLocaleString('en-US')} hint={`header + ${info.status === 'no-payload' ? '—' : `${info.headerLength} payload bytes`}`} />
      <Metric
        label="Bit error rate"
        value={info.ber ? (info.ber.ber === 0 ? '0' : info.ber.ber.toExponential(1)) : 'n/a'}
        tone={info.ber && info.ber.errors > 0 ? 'rose' : 'emerald'}
        hint={info.ber ? `${info.ber.errors} errors in ${info.ber.compared} bits` : 'needs the sent bits (same session)'}
      />
      <Metric label="Status" value={info.status === 'ok' ? 'OK' : info.status === 'auth-failed' ? 'TAG ✗' : 'NO SYNC'} tone={info.status === 'ok' ? 'emerald' : 'rose'} />
    </div>
  )
}

/** Everything the receiver learnt from the text lane. */
export function TextDecodePanel({ info, sent }: { info: TextDecodeInfo; sent: TextLaneInfo | null }) {
  return (
    <div className="space-y-4">
      <TextStatusBanner info={info} />
      <TextDecodeStats info={info} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
          <div className="mb-1 text-[11px] text-slate-400">BPSK constellation after despreading</div>
          <ConstellationPlot re={info.softRe} im={info.softIm} height={260} />
        </div>
        <BitGrid bits={info.bits} reference={sent?.bits} title="Received bits" />
      </div>
    </div>
  )
}

export function LaneStats({ info }: { info: TextLaneInfo }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge>
        lane {(info.laneLowHz / 1000).toFixed(2)}–{(info.laneHighHz / 1000).toFixed(2)} kHz
      </Badge>
      <Badge>{info.bits.length.toLocaleString('en-US')} bits</Badge>
      <Badge>{info.chipsPerBit} chips / bit</Badge>
      <Badge>
        {info.usedBins.toLocaleString('en-US')} / {info.laneBins.toLocaleString('en-US')} bins used
      </Badge>
      <Badge>capacity {info.capacityBytes} text bytes</Badge>
    </div>
  )
}
