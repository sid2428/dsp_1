import { RotateCcw } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { SignalRail } from './components/layout/signal-rail'
import { Segmented } from './components/ui/primitives'
import { ChannelStep } from './steps/channel-step'
import { EncodeStep } from './steps/encode-step'
import { OutputStep } from './steps/output-step'
import { ReceiverStep } from './steps/receiver-step'
import { SenderStep } from './steps/sender-step'
import { useStegoStore, type UIMode } from './store/use-stego-store'

const STEPS = [SenderStep, EncodeStep, ChannelStep, ReceiverStep, OutputStep]

function Mark() {
  return (
    <svg viewBox="0 0 32 20" className="h-5 w-8" aria-hidden="true">
      <path d="M1 10h5l2.5-7 4 14 3.5-10 2 5H31" fill="none" stroke="var(--color-teal)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="square" />
    </svg>
  )
}

export default function App() {
  const { step, uiMode, setUIMode, resetSession, cover, secret, hiddenText, receivedFile } = useStegoStore()
  const StepView = STEPS[step]
  const mainRef = useRef<HTMLElement>(null)
  const hasWork = !!(cover || secret || hiddenText || receivedFile)

  // Moving to another stage starts at its top, and focus follows for keyboard and screen-reader users.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [step])

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-teal focus:px-3 focus:py-2 focus:text-ink">
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pt-3 sm:px-8">
            <div className="flex items-center gap-3">
              <Mark />
              <span className="text-[15px] font-medium tracking-tight text-fg">SpectraHide</span>
              <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3 md:inline">audio steganography lab</span>
            </div>
            <div className="flex items-center gap-3">
              <Segmented<UIMode>
                label="Interface mode"
                value={uiMode}
                onChange={setUIMode}
                options={[
                  { value: 'beginner', label: 'Guided' },
                  { value: 'dsp', label: 'Technical' },
                ]}
              />
              <button
                type="button"
                onClick={resetSession}
                disabled={!hasWork}
                className="inline-flex h-8 items-center gap-1.5 px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-3 transition-colors hover:text-fg disabled:opacity-40 disabled:hover:text-fg-3"
                title="Clear every input and result"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">New session</span>
              </button>
            </div>
          </div>
          <div className="mx-auto mt-3 max-w-[1440px] px-4 sm:px-8">
            <SignalRail />
          </div>
        </header>

        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pb-24 pt-10 outline-none sm:px-8 sm:pt-14">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <StepView />
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mx-auto max-w-[1440px] border-t border-line px-4 py-6 font-mono text-[11px] text-fg-3 sm:px-8">
          All signal processing runs in this browser, in a Web Worker. Audio and text never leave the page — except microphone audio during dictation, which the browser’s own speech service receives.
        </footer>
      </div>
    </MotionConfig>
  )
}
