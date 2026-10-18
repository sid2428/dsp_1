import { AudioLines, Laptop, Radio } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '../ui/primitives'

/**
 * Restored from the original SpectraHide (commit 7c5ba4f, src/components/channel/transmission-animation.tsx):
 * the sender → channel → receiver strip with PCM packets flying across and noise particles on a noisy
 * channel. Its packet and noise motion, timing and endpoint light-up are kept exactly; the journey phases
 * around it (encoding, decoding, verified, failed) were added so the strip can follow the whole workflow.
 * Every phase is derived from real application state by the caller.
 */
export type JourneyPhase = 'compose' | 'encoding' | 'ready' | 'transmitting' | 'delivered' | 'decoding' | 'verified' | 'failed'

interface TransmissionAnimationProps {
  phase: JourneyPhase
  noisy: boolean
  /** The channel is not known (a file uploaded to the receiver could have come any way). */
  channelUnknown?: boolean
  /** Shorter strip for stages where the animation accompanies, rather than leads, the task. */
  compact?: boolean
  /** Override the sender endpoint caption (e.g. an independent receiver does not know the sender). */
  senderLabel?: string
  /** What failed, shown under the receiver (or sender) endpoint. */
  failure?: string
  /** Failure happened at the sender (encode) rather than at the receiver. */
  failedAtSender?: boolean
}

const RX_SUB: Record<JourneyPhase, string> = {
  compose: 'waiting…',
  encoding: 'waiting…',
  ready: 'waiting…',
  transmitting: 'waiting…',
  delivered: 'received.wav',
  decoding: 'decoding…',
  verified: 'verified',
  failed: 'not verified',
}

export function TransmissionAnimation({ phase, noisy, channelUnknown, compact, senderLabel, failure, failedAtSender }: TransmissionAnimationProps) {
  const channelText = channelUnknown ? 'unknown' : noisy ? 'noisy' : 'clean'
  const reduce = useReducedMotion()
  const active = phase === 'transmitting'
  const senderLit = phase !== 'compose' && !(failedAtSender && phase === 'failed')
  const delivered = phase === 'delivered' || phase === 'decoding' || phase === 'verified' || (phase === 'failed' && !failedAtSender)
  const txSub = failedAtSender && phase === 'failed' ? 'encode failed' : phase === 'compose' ? 'preparing' : phase === 'encoding' ? 'encoding…' : (senderLabel ?? 'stego.wav')
  const rxTone = phase === 'verified' ? 'ok' : phase === 'failed' && !failedAtSender ? 'err' : 'teal'

  return (
    <div
      role="img"
      aria-label={`Transmission: sender ${txSub}, channel ${channelText}${active ? ', sending' : ''}, receiver ${failedAtSender ? 'waiting' : RX_SUB[phase]}`}
      className={cn('relative flex items-center gap-3 border-y border-line sm:gap-4', compact ? 'py-3' : 'py-6')}
    >
      <Endpoint label="Sender" sub={txSub} icon={<Laptop className={compact ? 'size-5' : 'size-7'} />} lit={senderLit} tone={failedAtSender && phase === 'failed' ? 'err' : 'teal'} busy={phase === 'encoding'} compact={compact} />

      <div className={cn('relative grow overflow-hidden', compact ? 'h-14' : 'h-24')}>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-teal/60 via-blue/60 to-ok/60" />
        <div className="absolute left-1/2 top-1 -translate-x-1/2 bg-bg px-3 py-0.5 font-mono text-[10px] uppercase tracking-widest text-fg-3">
          channel · {channelText}
        </div>
        {active &&
          !reduce &&
          Array.from({ length: 6 }, (_, i) => (
            <motion.div
              key={`p${i}`}
              className="absolute top-1/2 -translate-y-1/2"
              initial={{ left: '-8%', opacity: 0 }}
              animate={{ left: '104%', opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3, ease: 'linear' }}
            >
              <Packet />
            </motion.div>
          ))}
        {active && reduce && (
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-around">
            {Array.from({ length: 4 }, (_, i) => (
              <Packet key={i} />
            ))}
          </div>
        )}
        {active &&
          noisy &&
          !reduce &&
          Array.from({ length: 18 }, (_, i) => (
            <motion.span
              key={`n${i}`}
              className="absolute size-1 rounded-full bg-err"
              style={{ left: `${(i * 37) % 100}%` }}
              initial={{ top: '50%', opacity: 0 }}
              animate={{ top: ['50%', `${20 + ((i * 53) % 60)}%`, '50%'], opacity: [0, 1, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: (i % 6) * 0.15 }}
            />
          ))}
      </div>

      <Endpoint
        label="Receiver"
        sub={failedAtSender ? 'waiting…' : RX_SUB[phase]}
        icon={<Radio className={compact ? 'size-5' : 'size-7'} />}
        lit={delivered}
        tone={rxTone}
        busy={phase === 'decoding'}
        compact={compact}
      />
      {failure && (
        <span className="sr-only" role="status">
          {failure}
        </span>
      )}
    </div>
  )
}

function Packet() {
  return (
    <div className="flex items-center gap-1 border border-teal/50 bg-teal/10 px-2 py-1 text-teal">
      <AudioLines className="size-3.5" aria-hidden="true" />
      <span className="font-mono text-[9px]">PCM</span>
    </div>
  )
}

function Endpoint({ label, sub, icon, lit, tone, busy, compact }: { label: string; sub: string; icon: ReactNode; lit: boolean; tone: 'teal' | 'ok' | 'err'; busy?: boolean; compact?: boolean }) {
  const ring = { teal: 'border-teal/60 text-teal', ok: 'border-ok text-ok', err: 'border-err text-err' }[tone]
  return (
    <motion.div
      animate={{ scale: lit ? 1 : 0.96, opacity: lit || busy ? 1 : 0.6 }}
      className={cn(
        'relative flex shrink-0 flex-col items-center gap-1.5 border bg-bg-2',
        compact ? 'w-24 p-2 sm:w-28' : 'w-28 p-4 sm:w-32',
        lit ? ring : busy ? 'border-blue text-blue' : 'border-line-2 text-fg-3',
      )}
    >
      {icon}
      <div className={cn('font-medium text-fg', compact ? 'text-[12px]' : 'text-sm')}>{label}</div>
      <div className={cn('max-w-full truncate font-mono text-[10px]', tone === 'ok' && lit ? 'text-ok' : tone === 'err' && lit ? 'text-err' : 'text-fg-3')}>
        {busy && <span className="rec-blink mr-1">●</span>}
        {sub}
      </div>
    </motion.div>
  )
}
