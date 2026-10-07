import { MessageSquareLock } from 'lucide-react'
import type { AudioClip } from '../../audio/load-audio'
import { computeLaneLayout, payloadCapacityBytes } from '../../dsp/bit-lane'
import { CHIPS_PER_BIT, LANE_HIGH_HZ, LANE_LOW_HZ, SAMPLE_RATE } from '../../dsp/constants'
import { CRYPTO_OVERHEAD, utf8Length } from '../../dsp/crypto'
import { fftSizeFor } from '../../dsp/stego'
import { Card, CardTitle, cn } from '../ui/primitives'

/** Free text bytes for a cover of this length (after header + AES-GCM overhead). */
export function textCapacity(cover: AudioClip | null): number | null {
  if (!cover) return null
  try {
    return payloadCapacityBytes(computeLaneLayout(fftSizeFor(cover.samples.length), SAMPLE_RATE)) - CRYPTO_OVERHEAD
  } catch {
    return 0
  }
}

export function HiddenTextCard({ text, onChange, cover }: { text: string; onChange: (t: string) => void; cover: AudioClip | null }) {
  const used = utf8Length(text)
  const capacity = textCapacity(cover)
  const over = capacity !== null && used > capacity
  const pct = capacity ? Math.min(100, (used / capacity) * 100) : 0

  return (
    <Card>
      <CardTitle
        icon={<MessageSquareLock className="size-4" />}
        title="4 · Hidden text message (optional)"
        hint={`AES-256-GCM encrypted, then BPSK phase-coded with ${CHIPS_PER_BIT}× spreading into the ${LANE_LOW_HZ / 1000}–${LANE_HIGH_HZ / 1000} kHz lane. Leave empty to send voice only.`}
      />
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Type a short secret text…"
        className={cn(
          'w-full resize-y rounded-xl bg-black/30 px-3 py-2 font-mono text-sm text-slate-100 outline-none ring-1 focus:ring-cyan-300/60',
          over ? 'ring-rose-400/70' : 'ring-white/10',
        )}
      />
      <div className="mt-2 flex items-center gap-3 text-xs">
        <div className="h-1.5 grow overflow-hidden rounded-full bg-white/10">
          <div className={cn('h-full rounded-full transition-all', over ? 'bg-rose-400' : 'bg-gradient-to-r from-cyan-400 to-violet-400')} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn('font-mono', over ? 'text-rose-300' : 'text-slate-400')}>
          {capacity === null ? `${used} bytes · load a cover to see capacity` : `${used} / ${capacity} bytes`}
        </span>
      </div>
      {over && <p className="mt-1 text-xs text-rose-300">Too long for this cover — shorten the text or use a longer cover track.</p>}
    </Card>
  )
}
