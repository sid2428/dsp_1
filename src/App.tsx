import { AlertTriangle, AudioWaveform, Loader2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Stepper } from './components/layout/stepper'
import { ChannelStep } from './steps/channel-step'
import { EncodeStep } from './steps/encode-step'
import { OutputStep } from './steps/output-step'
import { ReceiverStep } from './steps/receiver-step'
import { SenderStep } from './steps/sender-step'
import { useStegoStore } from './store/use-stego-store'

const STEP_INTRO = [
  { title: 'Sender', text: 'Pick a cover track that everyone may hear, the secret voice message to hide inside it, and a shared key.' },
  {
    title: 'Encoding in the frequency domain',
    text: 'The secret is band-limited, reversed in time, spectrally inverted, shuffled with the key and parked at 16.5–19.9 kHz inside the cover.',
  },
  { title: 'Transmission', text: 'The stego file travels like any other audio file. Optionally add noise or volume changes to test robustness.' },
  {
    title: 'Receiver — FFT decoding',
    text: 'A radix-2 FFT (DIT or DIF) moves the received audio to the frequency domain, where the hidden band is cut out and every scrambling step is undone.',
  },
  { title: 'Output', text: 'Listen to both outputs: the innocent music, and the voice message only the key holder can recover.' },
]

const STEPS = [SenderStep, EncodeStep, ChannelStep, ReceiverStep, OutputStep]

const BUSY_TEXT = {
  encode: 'Encoding — two-for-one FFTs, FIR filtering, spectral scrambling and three inverse FFTs on ~1M-point spectra…',
  channel: 'Transmitting — applying channel gain, noise and 16-bit quantisation…',
  decode: 'Decoding — radix-2 FFT of the received audio, band extraction, unscrambling (also with a wrong key for comparison)…',
} as const

export default function App() {
  const { step, error, setError, busy } = useStegoStore()
  const StepView = STEPS[step]
  const intro = STEP_INTRO[step]

  return (
    <div className="bg-grid min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-violet-500 text-ink-950 shadow-lg shadow-cyan-500/30">
              <AudioWaveform className="size-5" />
            </div>
            <div>
              <div className="text-base font-extrabold tracking-tight text-white">SpectraHide</div>
              <div className="text-[11px] text-slate-400">Audio-in-audio steganography · FFT band embedding · time reversal</div>
            </div>
          </div>
          <Stepper />
        </div>
        {busy && (
          <motion.div
            className="h-0.5 bg-gradient-to-r from-cyan-400 via-violet-400 to-cyan-400"
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: [0, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="mb-6">
              <div className="font-mono text-xs text-cyan-300">STEP {step + 1} / 5</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">{intro.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">{intro.text}</p>
            </div>
            <StepView />
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="mx-auto max-w-7xl px-6 pb-8 text-center text-[11px] text-slate-500">
        All signal processing runs in your browser (TypeScript radix-2 FFT in a Web Worker). No audio leaves this page.
      </footer>

      <AnimatePresence>
        {busy && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,620px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink-800/95 p-4 text-sm text-slate-200 shadow-2xl ring-1 ring-cyan-400/40"
          >
            <Loader2 className="size-5 shrink-0 animate-spin text-cyan-300" />
            <span>{BUSY_TEXT[busy]}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,560px)] -translate-x-1/2 items-start gap-3 rounded-2xl bg-rose-950/95 p-4 text-sm text-rose-100 shadow-2xl ring-1 ring-rose-400/40"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-300" />
            <span className="grow">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-300 hover:text-white">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
