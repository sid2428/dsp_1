import { Eraser, Mic, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AudioClip } from '../../audio/load-audio'
import { isTranscriptionSupported, SpeechTranscriber } from '../../audio/speech-to-text'
import { CHIPS_PER_BIT } from '../../dsp/constants'
import { CRYPTO_OVERHEAD } from '../../dsp/crypto'
import { capacityInfo } from '../../steps/sender-validation'
import { Button, Notice, cn } from '../ui/primitives'

const SAMPLE_TEXT = 'Meet the DSP team at lab 4 at 5 PM. Bring the FFT notes!'

interface MessageComposerProps {
  text: string
  onChange: (t: string) => void
  cover: AudioClip | null
}

/** Byte-exact capacity bar: each tick is 16 bytes of plaintext. */
function CapacityBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const over = limit !== null && used > limit
  const ticks = limit ? Math.floor(limit / 16) : 0
  return (
    <div className="relative h-2 bg-bg" role="meter" aria-label="Text lane capacity used" aria-valuemin={0} aria-valuemax={limit ?? 0} aria-valuenow={Math.min(used, limit ?? used)}>
      <div className={cn('absolute inset-y-0 left-0 transition-[width] duration-200', over ? 'bg-err' : pct > 90 ? 'bg-warn' : 'bg-teal')} style={{ width: `${over ? 100 : pct}%` }} />
      {Array.from({ length: ticks }, (_, i) => (
        <span key={i} className="absolute inset-y-0 w-px bg-bg-2" style={{ left: `${(((i + 1) * 16) / (limit ?? 1)) * 100}%` }} />
      ))}
    </div>
  )
}

export function MessageComposer({ text, onChange, cover }: MessageComposerProps) {
  const cap = capacityInfo(cover, text)
  const [replaced, setReplaced] = useState<string | null>(null)
  const [dictating, setDictating] = useState(false)
  const [heard, setHeard] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const transcriber = useRef<SpeechTranscriber | null>(null)
  const supported = isTranscriptionSupported()

  useEffect(() => () => transcriber.current?.abort(), [])

  const replace = (next: string) => {
    if (next === text) return
    setReplaced(text)
    onChange(next)
  }

  const startDictation = () => {
    setNote(null)
    setHeard('')
    const t = new SpeechTranscriber()
    if (!t.start({ onUpdate: (s, p) => setHeard(`${s} ${p}`.trim()), onError: setNote })) {
      setNote('Speech recognition could not start in this browser. Type the message instead.')
      return
    }
    transcriber.current = t
    setDictating(true)
  }

  const stopDictation = async () => {
    const t = transcriber.current
    transcriber.current = null
    setDictating(false)
    const spoken = t ? (await t.stop().catch(() => '')).trim() : ''
    setHeard('')
    if (spoken) replace(text.trim() ? `${text.trimEnd()} ${spoken}` : spoken)
    else if (!note) setNote('No speech was recognised, so the message was left unchanged.')
  }

  const status = cap.error && text.trim()
    ? { tone: 'text-err', text: cap.error }
    : cap.limit === null
      ? { tone: 'text-fg-3', text: 'Load a cover to see the exact capacity.' }
      : cap.over
        ? { tone: 'text-err', text: `${cap.used - cap.limit} bytes over. Shorten the text or use a longer cover.` }
        : { tone: 'text-fg-3', text: `${cap.remaining} bytes free` }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="hidden-text" className="text-[15px] text-fg">
          Text message
        </label>
        <span className="font-mono text-[11px] text-fg-3">AES-256-GCM · BPSK ×{CHIPS_PER_BIT} chips</span>
      </div>
      <div className={cn('mt-2 border bg-bg-2 transition-colors focus-within:border-teal', cap.over ? 'border-err' : 'border-line')}>
        <textarea
          id="hidden-text"
          value={dictating && heard ? `${text}${text && !text.endsWith(' ') ? ' ' : ''}${heard}` : text}
          readOnly={dictating}
          onChange={(e) => {
            setReplaced(null)
            onChange(e.target.value)
          }}
          rows={4}
          placeholder="Type the secret text…"
          aria-describedby="hidden-text-cap"
          aria-invalid={cap.over || undefined}
          className="block min-h-[112px] w-full resize-y bg-transparent px-3.5 py-3 font-mono text-[14px] leading-relaxed text-fg outline-none placeholder:text-fg-3/70"
        />
      </div>

      <div className="mt-3 space-y-2" id="hidden-text-cap">
        <CapacityBar used={cap.used} limit={cap.limit} />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[11px]">
          <span className="text-fg-2">
            <span className={cn(cap.over ? 'text-err' : 'text-fg')}>{cap.used}</span>
            {cap.limit !== null && <span> / {cap.limit}</span>} bytes UTF-8 · {cap.characters} characters
          </span>
          <span className={status.tone}>{status.text}</span>
        </div>
        {cap.limit !== null && cap.used > 0 && (
          <p className="font-mono text-[11px] text-fg-3">
            on air: {cap.used} + {CRYPTO_OVERHEAD} (salt, IV, tag) + 3 header = {cap.used + CRYPTO_OVERHEAD + 3} bytes → {(cap.used + CRYPTO_OVERHEAD + 3) * 8 * CHIPS_PER_BIT} FFT bins
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {supported && (
          <Button
            variant={dictating ? 'danger' : 'secondary'}
            size="sm"
            icon={dictating ? <Square className="size-3.5" aria-hidden="true" /> : <Mic className="size-3.5" aria-hidden="true" />}
            onClick={() => void (dictating ? stopDictation() : startDictation())}
          >
            {dictating ? 'Stop dictation' : 'Dictate'}
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<Sparkles className="size-3.5" aria-hidden="true" />} onClick={() => replace(SAMPLE_TEXT)} disabled={dictating}>
          Sample text
        </Button>
        <Button variant="ghost" size="sm" icon={<Eraser className="size-3.5" aria-hidden="true" />} onClick={() => replace('')} disabled={!text || dictating}>
          Clear
        </Button>
        {replaced !== null && !dictating && (
          <button
            type="button"
            onClick={() => {
              onChange(replaced)
              setReplaced(null)
            }}
            className="ml-auto font-mono text-[11px] text-fg-3 hover:text-fg"
          >
            undo last change
          </button>
        )}
      </div>
      <div className="mt-2 space-y-2" aria-live="polite">
        {dictating && <p className="font-mono text-[11px] text-blue">● listening — words appear as the browser’s speech service recognises them</p>}
        {supported && !dictating && <p className="text-[12px] text-fg-3">Dictation uses the browser’s speech recognition; in Chrome the microphone audio is sent to Google’s speech service. Everything else stays on this page.</p>}
        {note && <Notice tone="info">{note}</Notice>}
        {!supported && <p className="text-[12px] text-fg-3">Dictation needs the Web Speech API (Chrome, Edge, Safari). It only works on a live microphone — uploaded files cannot be transcribed in the browser.</p>}
      </div>
    </div>
  )
}
