import { AudioLines, Laptop, Radio } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '../ui/primitives'

interface TransmissionAnimationProps {
  active: boolean
  delivered: boolean
  noisy: boolean
}

/** Sender → channel → receiver with audio packets flying across. */
export function TransmissionAnimation({ active, delivered, noisy }: TransmissionAnimationProps) {
  return (
    <div className="relative flex items-center gap-4 rounded-2xl bg-black/30 p-6 ring-1 ring-white/10">
      <Endpoint label="Sender" sub="stego.wav" icon={<Laptop className="size-7" />} lit />

      <div className="relative h-24 grow overflow-hidden">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-cyan-400/60 via-violet-400/60 to-emerald-400/60" />
        <div className="absolute left-1/2 top-1 -translate-x-1/2 rounded-full bg-white/5 px-3 py-0.5 text-[10px] uppercase tracking-widest text-slate-400 ring-1 ring-white/10">
          channel {noisy ? '· noisy' : '· clean'}
        </div>
        {active &&
          Array.from({ length: 6 }, (_, i) => (
            <motion.div
              key={`p${i}`}
              className="absolute top-1/2 -translate-y-1/2"
              initial={{ left: '-8%', opacity: 0 }}
              animate={{ left: '104%', opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3, ease: 'linear' }}
            >
              <div className="flex items-center gap-1 rounded-lg bg-cyan-400/15 px-2 py-1 text-cyan-200 ring-1 ring-cyan-300/40">
                <AudioLines className="size-3.5" />
                <span className="font-mono text-[9px]">PCM</span>
              </div>
            </motion.div>
          ))}
        {active &&
          noisy &&
          Array.from({ length: 18 }, (_, i) => (
            <motion.span
              key={`n${i}`}
              className="absolute size-1 rounded-full bg-rose-400"
              style={{ left: `${(i * 37) % 100}%` }}
              initial={{ top: '50%', opacity: 0 }}
              animate={{ top: ['50%', `${20 + ((i * 53) % 60)}%`, '50%'], opacity: [0, 1, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: (i % 6) * 0.15 }}
            />
          ))}
      </div>

      <Endpoint label="Receiver" sub={delivered ? 'received.wav' : 'waiting…'} icon={<Radio className="size-7" />} lit={delivered} />
    </div>
  )
}

function Endpoint({ label, sub, icon, lit }: { label: string; sub: string; icon: ReactNode; lit: boolean }) {
  return (
    <motion.div
      animate={{ scale: lit ? 1 : 0.96, opacity: lit ? 1 : 0.6 }}
      className={cn(
        'flex w-32 shrink-0 flex-col items-center gap-2 rounded-2xl bg-ink-800 p-4 ring-1',
        lit ? 'text-cyan-200 ring-cyan-400/50' : 'text-slate-400 ring-white/10',
      )}
    >
      {icon}
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="font-mono text-[10px] text-slate-400">{sub}</div>
    </motion.div>
  )
}
