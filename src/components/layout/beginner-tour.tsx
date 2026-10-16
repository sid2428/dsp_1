import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { useStegoStore } from '../../store/use-stego-store'
import { Button } from '../ui/primitives'

export interface BeginnerTourStep {
  target: string
  title: string
  text: string
}

interface BeginnerTourProps {
  open: boolean
  steps: BeginnerTourStep[]
  onClose: () => void
}

interface TargetRect {
  top: number
  left: number
  width: number
  height: number
}

const SPOTLIGHT_PADDING = 8

/** Stages whose tour has already been shown this session. */
const seen = new Set<string>()

/** Guided mode opens each stage's tour once per session; it can always be reopened by hand. */
export function useStageTour(stage: string): [boolean, (open: boolean) => void] {
  const guided = useStegoStore((s) => s.uiMode === 'beginner')
  const [open, setOpen] = useState(() => guided && !seen.has(stage))
  useEffect(() => {
    if (open) seen.add(stage)
  }, [open, stage])
  useEffect(() => {
    if (!guided) setOpen(false)
  }, [guided])
  return [open && guided, setOpen]
}
const POPUP_WIDTH = 320
const POPUP_HEIGHT = 190

export function BeginnerTour({ open, steps, onClose }: BeginnerTourProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null)
  const [popupPosition, setPopupPosition] = useState({ top: 24, left: 24 })
  const step = steps[currentStep]

  useLayoutEffect(() => {
    if (!open || !step) return
    const target = document.querySelector<HTMLElement>(`[data-tour-target="${step.target}"]`)
    if (!target) {
      setTargetRect(null)
      return
    }

    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const updatePosition = () => {
      const rect = target.getBoundingClientRect()
      setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
      const popupWidth = Math.min(POPUP_WIDTH, window.innerWidth - 32)
      const popupHeight = Math.min(POPUP_HEIGHT, window.innerHeight - 32)
      const gap = 18
      const right = rect.right + gap
      const left = rect.left - popupWidth - gap
      const below = rect.bottom + gap
      const above = rect.top - popupHeight - gap
      const clampTop = (top: number) => Math.max(16, Math.min(top, window.innerHeight - popupHeight - 16))
      if (right + popupWidth <= window.innerWidth - 16) setPopupPosition({ top: clampTop(rect.top), left: right })
      else if (left >= 16) setPopupPosition({ top: clampTop(rect.top), left })
      else if (below + popupHeight <= window.innerHeight - 16) setPopupPosition({ top: below, left: Math.max(16, Math.min(rect.left, window.innerWidth - popupWidth - 16)) })
      else setPopupPosition({ top: Math.max(16, above), left: Math.max(16, Math.min(rect.left, window.innerWidth - popupWidth - 16)) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [currentStep, open, step])

  const visible = open && targetRect !== null
  useEffect(() => {
    if (!visible) return
    document.getElementById('beginner-tour-next')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowLeft' && currentStep > 0) {
        event.preventDefault()
        setCurrentStep((value) => value - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (currentStep < steps.length - 1) setCurrentStep((value) => value + 1)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [currentStep, onClose, visible, steps.length])

  useEffect(() => {
    if (!open) setCurrentStep(0)
  }, [open])

  if (!step) return null
  return (
    <AnimatePresence>
      {open && targetRect && (
        <>
          <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true" onClick={onClose} />
          <motion.div
            className="pointer-events-none fixed z-[41] border border-teal shadow-[0_0_0_9999px_rgba(3,10,17,0.72)]"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, top: targetRect.top - SPOTLIGHT_PADDING, left: targetRect.left - SPOTLIGHT_PADDING, width: targetRect.width + SPOTLIGHT_PADDING * 2, height: targetRect.height + SPOTLIGHT_PADDING * 2 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="beginner-tour-title"
            className="fixed z-[42] w-[min(320px,calc(100vw-2rem))] border border-line-2 bg-panel p-4 text-fg"
            style={{ top: popupPosition.top, left: popupPosition.left }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal">Guide {currentStep + 1} / {steps.length}</span>
              <button type="button" onClick={onClose} className="px-2 py-1 font-mono text-[11px] text-fg-3 hover:text-fg" aria-label="Close the guide">Close · Esc</button>
            </div>
            <h2 id="beginner-tour-title" className="mt-3 text-[15px] font-medium text-fg">{step.title}</h2>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-fg-2">{step.text}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCurrentStep((value) => value - 1)} disabled={currentStep === 0} aria-label="Go to previous tour step">Previous</Button>
              <Button id="beginner-tour-next" type="button" size="sm" onClick={() => (currentStep === steps.length - 1 ? onClose() : setCurrentStep((value) => value + 1))} aria-label={currentStep === steps.length - 1 ? 'Finish beginner tour' : 'Go to next tour step'}>{currentStep === steps.length - 1 ? 'Finish' : 'Next'}</Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
