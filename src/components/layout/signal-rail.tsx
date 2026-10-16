import { motion } from 'motion/react'
import { validateSender } from '../../steps/sender-validation'
import { useStegoStore, type StepIndex } from '../../store/use-stego-store'
import { cn, fmtDb, fmtMs } from '../ui/primitives'

const STATIONS = [
  { label: 'Sender', role: 'Studio' },
  { label: 'Encode', role: 'Processor' },
  { label: 'Transfer', role: 'Channel' },
  { label: 'Receiver', role: 'Decoder' },
  { label: 'Results', role: 'Report' },
] as const

type Tone = 'idle' | 'live' | 'done' | 'bad'

/** One status line per station, derived only from real state. */
function useStatuses(): { text: string; tone: Tone }[] {
  const s = useStegoStore()
  const ready = validateSender({ ...s, mode: s.payloadMode }).ready
  return [
    s.encoded ? { text: 'inputs locked in', tone: 'done' } : ready ? { text: 'ready to encode', tone: 'done' } : { text: 'needs inputs', tone: 'idle' },
    s.busy === 'encode'
      ? { text: 'processing…', tone: 'live' }
      : s.encodeError
        ? { text: 'failed', tone: 'bad' }
        : s.encoded
          ? { text: `done · ${fmtMs(s.encoded.totalMs)} ms`, tone: 'done' }
          : { text: 'waiting', tone: 'idle' },
    s.busy === 'channel' || s.busy === 'deliver'
      ? { text: 'sending…', tone: 'live' }
      : s.transmitted
        ? { text: `${fmtDb(s.transmitted.channelSnrDb)} dB SNR`, tone: 'done' }
        : s.encoded
          ? { text: 'stego ready', tone: 'idle' }
          : { text: 'locked', tone: 'idle' },
    s.busy === 'decode'
      ? { text: 'decoding…', tone: 'live' }
      : s.decodeError
        ? { text: 'failed', tone: 'bad' }
        : s.decoded
          ? s.decoded.text.status === 'auth-failed' || s.decoded.text.status === 'no-payload'
            ? { text: 'no verified message', tone: 'bad' }
            : { text: 'message recovered', tone: 'done' }
          : s.receivedFile
            ? { text: 'file loaded', tone: 'idle' }
            : { text: 'standalone', tone: 'idle' },
    s.decoded ? { text: 'available', tone: 'done' } : { text: 'locked', tone: 'idle' },
  ]
}

export function SignalRail() {
  const { step, goTo, canVisit } = useStegoStore()
  const statuses = useStatuses()

  return (
    <nav aria-label="Stages" className="grid grid-cols-5">
      {STATIONS.map((st, i) => {
        const idx = i as StepIndex
        const active = step === idx
        const enabled = canVisit(idx)
        const status = statuses[i]
        const nextEnabled = i < 4 && canVisit((i + 1) as StepIndex) && status.tone === 'done'
        return (
          <button
            key={st.label}
            type="button"
            onClick={() => goTo(idx)}
            disabled={!enabled}
            aria-current={active ? 'step' : undefined}
            className={cn('group relative min-w-0 pb-3 pt-4 text-left transition-colors', enabled ? 'cursor-pointer' : 'cursor-not-allowed')}
          >
            {/* the wire to the next station */}
            <span aria-hidden="true" className="absolute left-0 right-0 top-0 h-px bg-line-2" />
            {i < 4 && (
              <motion.span
                aria-hidden="true"
                className="absolute left-0 top-0 h-px origin-left bg-teal"
                style={{ right: 0 }}
                initial={false}
                animate={{ scaleX: nextEnabled ? 1 : 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute -top-[4px] left-0 size-[9px] border transition-colors',
                active ? 'border-teal bg-teal' : status.tone === 'done' ? 'border-teal bg-bg' : status.tone === 'bad' ? 'border-err bg-bg' : status.tone === 'live' ? 'border-blue bg-blue' : 'border-line-2 bg-bg',
              )}
            />
            {active && <motion.span layoutId="rail-active" aria-hidden="true" className="absolute left-0 top-[-1px] h-[3px] w-12 bg-teal" transition={{ type: 'spring', bounce: 0, duration: 0.45 }} />}
            <span className="flex items-baseline gap-2 pr-2">
              <span className={cn('font-mono text-[11px]', active ? 'text-teal' : 'text-fg-3')}>0{i + 1}</span>
              <span className={cn('truncate text-[13px] font-medium sm:text-[14px]', active ? 'text-fg' : enabled ? 'text-fg-2 group-hover:text-fg' : 'text-fg-3')}>{st.label}</span>
            </span>
            <span
              className={cn(
                'mt-0.5 hidden truncate pr-2 font-mono text-[11px] sm:block',
                status.tone === 'bad' ? 'text-err' : status.tone === 'live' ? 'text-blue' : status.tone === 'done' ? 'text-ok' : 'text-fg-3',
              )}
            >
              {status.tone === 'live' && <span className="rec-blink mr-1">●</span>}
              {status.text}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
