import { AudioWaveform, ArrowRight, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { UIMode } from '../../store/use-stego-store'

interface WelcomeScreenProps {
  onSelectMode: (mode: UIMode) => void
}

const MODES = [
  {
    mode: 'beginner' as const,
    title: 'Beginner Mode',
    description: 'Learn step by step with guided tours explaining what, why, and how.',
    label: 'Guided learning',
    icon: Sparkles,
    accent: 'from-cyan-400/20 to-cyan-400/5',
    iconClassName: 'bg-cyan-400/15 text-cyan-300 ring-cyan-300/25',
  },
  {
    mode: 'dsp' as const,
    title: 'DSP Mode',
    description: 'Explore the complete technical interface, visualizations, controls, and signal metrics directly.',
    label: 'Technical exploration',
    icon: SlidersHorizontal,
    accent: 'from-violet-400/20 to-violet-400/5',
    iconClassName: 'bg-violet-400/15 text-violet-300 ring-violet-300/25',
  },
] as const

export function WelcomeScreen({ onSelectMode }: WelcomeScreenProps) {
  return (
    <div className="bg-grid flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-5xl grow items-center px-4 py-12 sm:px-6 sm:py-16">
        <section className="w-full text-center" aria-labelledby="welcome-title">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-violet-500 text-ink-950 shadow-xl shadow-cyan-500/20">
            <AudioWaveform className="size-8" aria-hidden="true" />
          </div>
          <p className="mt-6 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">SpectraHide</p>
          <h1 id="welcome-title" className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">Welcome to SpectraHide</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-400 sm:text-lg">Audio-in-audio steganography with FFT decoding</p>
          <p className="mt-10 text-sm font-medium text-slate-200 sm:text-base">How would you like to explore SpectraHide?</p>

          <div className="mx-auto mt-6 grid max-w-4xl gap-4 text-left md:grid-cols-2">
            {MODES.map(({ mode, title, description, label, icon: Icon, accent, iconClassName }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onSelectMode(mode)}
                className={`group flex min-h-56 flex-col rounded-2xl border border-white/10 bg-gradient-to-br ${accent} p-6 text-left shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-cyan-300/45 hover:shadow-cyan-500/10 focus-visible:border-cyan-300/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950`}
              >
                <span className="flex items-start justify-between gap-4">
                  <span className={`grid size-11 place-items-center rounded-xl ring-1 ${iconClassName}`}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <ArrowRight className="mt-1 size-5 text-slate-500 transition group-hover:translate-x-1 group-hover:text-cyan-300" aria-hidden="true" />
                </span>
                <span className="mt-6 text-xl font-bold text-white">{title}</span>
                <span className="mt-2 text-sm leading-relaxed text-slate-300">{description}</span>
                <span className="mt-auto pt-5 text-xs font-semibold uppercase tracking-wider text-cyan-300">{label}</span>
              </button>
            ))}
          </div>

          <p className="mt-7 text-xs text-slate-500">You can switch modes later from the application header.</p>
        </section>
      </main>
      <footer className="px-6 pb-8 text-center text-[11px] text-slate-500">
        All signal processing runs in your browser. No audio leaves this page.
      </footer>
    </div>
  )
}
