import { ArrowLeft, ArrowRight, ChevronDown, Play, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { ButterflyExplorer } from '../components/butterfly/butterfly-explorer'
import { useJourney } from '../components/channel/journey'
import { TransmissionAnimation } from '../components/channel/transmission-animation'
import { LineChart } from '../components/charts/line-chart'
import { SpectrumAnalyzer } from '../components/charts/spectrum-analyzer'
import { ProcessLog } from '../components/diagram/process-log'
import { SignalDiagram, type NodeState } from '../components/diagram/signal-diagram'
import { useWalkthrough, WalkthroughControls } from '../components/diagram/walkthrough'
import { BeginnerTour, useStageTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { StageFrame } from '../components/layout/stage-frame'
import { PermutationView } from '../components/pipeline/permutation-view'
import { BitGrid, CipherFrameView } from '../components/text-lane/text-lane-views'
import { Button, Eyebrow, Notice, Readout, cn, fmtMs } from '../components/ui/primitives'
import { FIR_TAPS, SAMPLE_RATE } from '../dsp/constants'
import { peak } from '../dsp/analysis'
import { ENCODER_EDGES, ENCODER_NODE_STAGE, ENCODER_NODES, ENCODE_STEP_LABEL, ENCODE_STEP_ORDER, encoderSteps, type EncoderWalkStep } from '../pipeline/encoder-pipeline'
import { useStegoStore } from '../store/use-stego-store'
import type { EncodeOutput } from '../worker/protocol'

const TOUR: BeginnerTourStep[] = [
  { target: 'enc-spectrum', title: 'What changed', text: 'Hover the spectrum to read exact values. The stego (solid) matches the cover (dashed) everywhere except the two hidden bands.' },
  { target: 'enc-butterfly', title: 'The FFT itself', text: 'These butterflies are the encoder’s own FFT routine running on a few real input samples. Step through them, or press Play.' },
]

/** Blocks a missing input never reaches. */
function offNodes(hasVoice: boolean, textContent: 'voice+text' | 'text' | 'voice' | null): Set<string> {
  const off = new Set<string>()
  if (!hasVoice) ['voice', 'fir', 'reverse', 'invert', 'permute', 'shift'].forEach((id) => off.add(id))
  if (textContent === null) ['text', 'aes', 'frame', 'spread'].forEach((id) => off.add(id))
  if (textContent === 'voice') off.add('text')
  return off
}

function Extra({ step, enc }: { step: EncoderWalkStep; enc: EncodeOutput }) {
  switch (step.id) {
    case 'fir':
      return (
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">|H(f)| · {FIR_TAPS} taps, Hamming window</div>
          <LineChart
            series={[{ x: enc.firResponse.freqs, y: enc.firResponse.magDb, color: '#4ea5ff', label: '|H(f)|' }]}
            xDomain={[0, 6000]}
            yDomain={[-100, 5]}
            height={170}
            xFormat={(v) => (v / 1000).toFixed(1)}
            yLabel="dB"
            ariaLabel="Magnitude response of the FIR band-pass filter"
          />
        </div>
      )
    case 'permute':
      return <PermutationView permutation={enc.permutation} caption="derived from the sender key" />
    case 'aes':
      return enc.text ? <CipherFrameView cipher={enc.text.cipher} plaintext={enc.text.plaintext} /> : null
    case 'spread':
      return enc.text ? <BitGrid bits={enc.text.bits} title="Transmitted bits" /> : null
    case 'ifft':
      return (
        <dl className="grid max-w-md">
          <Readout label="Peak (stego)" value={peak(enc.stages.stego.samples).toFixed(4)} />
          <Readout label="Limiter scale" value={enc.clipScale === 1 ? 'none' : enc.clipScale.toFixed(4)} />
          <Readout label="Samples" value={enc.stages.stego.samples.length.toLocaleString('en-US')} />
        </dl>
      )
    default:
      return null
  }
}

function Walkthrough({ enc }: { enc: EncodeOutput }) {
  const steps = useMemo(() => encoderSteps(enc), [enc])
  const w = useWalkthrough(steps.length, enc)
  const step = steps[w.index]
  const off = useMemo(() => offNodes(enc.hasVoice, enc.text?.content ?? null), [enc])
  const timings = useMemo(() => new Map(enc.log.map((t) => [t.stage, t.ms])), [enc])

  const states = useMemo(() => {
    const st: Record<string, NodeState> = {}
    const shownUpTo = new Set<string>()
    steps.slice(0, w.index).forEach((s) => s.nodes.forEach((id) => shownUpTo.add(id)))
    for (const n of ENCODER_NODES) {
      st[n.id] = off.has(n.id) ? 'off' : step.nodes.includes(n.id) ? 'active' : shownUpTo.has(n.id) || ENCODER_NODE_STAGE[n.id] === 'start' ? 'done' : 'idle'
    }
    return st
  }, [steps, step, w.index, off])

  const select = (id: string) => {
    const i = steps.findIndex((s) => s.nodes.includes(id))
    if (i >= 0) w.go(i)
  }

  const stageView = step.stage ? enc.stages[step.stage] : null
  const beforeView = step.before ? enc.stages[step.before] : null

  return (
    <>
      <div data-tour-target="encode-diagram" className="border-y border-line py-5">
        <SignalDiagram nodes={ENCODER_NODES} edges={ENCODER_EDGES} states={states} onSelect={select} rows={3} cols={9} label="Encoder block diagram" />
      </div>
      <div data-tour-target="encode-transport" className="border-b border-line py-4">
        <WalkthroughControls w={w} label="Encoder walkthrough" />
      </div>

      <div data-tour-target="encode-inspector" className="pt-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            <div className="grid gap-x-10 gap-y-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="min-w-0">
                <Eyebrow index={String(w.index + 1).padStart(2, '0')} tone="teal">
                  {step.timing ? `${ENCODE_STEP_LABEL[step.timing]} · ${fmtMs(timings.get(step.timing) ?? 0)} ms measured` : 'inputs'}
                </Eyebrow>
                <h2 className="mt-2 text-[22px] font-light text-fg">{step.title}</h2>
                <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-fg-2">{step.body}</p>
              </div>
              {step.formula && <div className="self-start border-l border-teal/60 py-1 pl-4 font-mono text-[12px] leading-relaxed text-fg">{step.formula}</div>}
            </div>

            {stageView && (
              <div className="mt-6 max-w-3xl">
                <WaveformPlayer samples={stageView.samples} label="Signal at this block" note={step.normalize ? 'loudness normalised for listening' : undefined} normalize={step.normalize} color="teal" height={56} />
              </div>
            )}

            {stageView && (
              <div className="mt-8">
                <SpectrumAnalyzer
                  output={stageView.samples}
                  input={beforeView?.samples ?? null}
                  layout={enc.layout}
                  outputLabel="after this block"
                  inputLabel="entering"
                  initialZoom={step.id === 'fir' || step.id === 'reverse' || step.id === 'invert' || step.id === 'permute' ? 'speech' : step.id === 'spread' ? 'hidden' : 'full'}
                />
              </div>
            )}

            <div className="mt-8 empty:hidden">
              <Extra step={step} enc={enc} />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

/** While the worker runs: the same diagram, lit only by stages the worker has reported finished. */
function LiveDiagram() {
  const { encodeLog, busy, secret, payloadMode } = useStegoStore()
  const done = new Set(encodeLog.map((t) => t.stage))
  const pending = ENCODE_STEP_ORDER.find((s) => !done.has(s))
  const off = offNodes(payloadMode === 'voice' && !!secret, payloadMode === 'voice' ? 'voice' : 'text')
  const states: Record<string, NodeState> = {}
  for (const n of ENCODER_NODES) {
    const stage = ENCODER_NODE_STAGE[n.id]
    states[n.id] = off.has(n.id) ? 'off' : stage === 'start' || done.has(stage as never) ? 'done' : busy === 'encode' && stage === pending ? 'running' : 'idle'
  }
  return (
    <div className="border-y border-line py-5">
      <SignalDiagram nodes={ENCODER_NODES} edges={ENCODER_EDGES} states={states} rows={3} cols={9} label="Encoder block diagram, live progress" />
    </div>
  )
}

export function EncodeStep() {
  const { encoded, busy, encodeLog, encodeError, encode, goTo, cover, cancel, cancelled, canVisit } = useStegoStore()
  const [tourOpen, setTourOpen] = useStageTour('encode')
  const [explore, setExplore] = useState(false)
  const running = busy === 'encode'
  const journey = useJourney('encode')

  // Encoding runs by itself whenever there are valid inputs and no current result.
  useEffect(() => {
    if (!encoded && !busy && !encodeError && cancelled !== 'encode' && canVisit(1)) void encode()
  }, [encoded, busy, encodeError, cancelled, canVisit, encode])

  const aside = (
    <>
      <ProcessLog order={ENCODE_STEP_ORDER} labels={ENCODE_STEP_LABEL} log={encodeLog} running={running} failed={!!encodeError} />
      {running && (
        <Button className="w-full" variant="secondary" onClick={cancel} icon={<X className="size-4" aria-hidden="true" />}>
          Cancel
        </Button>
      )}
      {encoded && (
        <dl>
          <Readout label="Payload" value={encoded.hasVoice ? 'voice + key token' : 'text'} />
          <Readout label="FFT size" value={`2^${Math.log2(encoded.fftSize)} = ${encoded.fftSize.toLocaleString('en-US')}`} />
          <Readout label="Bin spacing" value={`${encoded.layout.binHz.toFixed(4)} Hz`} />
          <Readout label="Stego length" value={`${(encoded.stages.stego.samples.length / SAMPLE_RATE).toFixed(2)} s`} />
          <Readout label="Wall time" value={`${fmtMs(encoded.totalMs)} ms`} tone="ok" />
        </dl>
      )}
      <div className="space-y-2">
        <Button className="w-full" size="lg" onClick={() => goTo(2)} disabled={!encoded} icon={<ArrowRight className="size-4" aria-hidden="true" />}>
          Continue to transfer
        </Button>
        <Button className="w-full" variant="ghost" onClick={() => goTo(0)} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
          Back to sender
        </Button>
      </div>
    </>
  )

  return (
    <StageFrame
      index="02"
      role="Processing instrument"
      title="Encode"
      lead={
        running
          ? 'The encoder is running in a Web Worker. Blocks light up only when the worker reports them finished.'
          : encoded
            ? 'Done. Below: what hiding changed in the cover, and the FFT that did it — both computed from your audio.'
            : 'The encoder runs automatically on your inputs.'
      }
      aside={aside}
    >
      <TransmissionAnimation compact phase={journey.phase} noisy={journey.noisy} failedAtSender={journey.failedAtSender} />

      {encodeError && (
        <div className="mt-6 space-y-3">
          <Notice tone="error" title="Encoding failed">
            {encodeError}
          </Notice>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => goTo(0)} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
              Fix inputs
            </Button>
            <Button variant="ghost" onClick={() => void encode()}>
              Retry
            </Button>
          </div>
        </div>
      )}
      {cancelled === 'encode' && !running && !encoded && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Notice tone="info">Encoding was cancelled. Nothing was produced.</Notice>
          <Button variant="secondary" onClick={() => void encode()} disabled={!cover} icon={<Play className="size-4" aria-hidden="true" />}>
            Run again
          </Button>
        </div>
      )}

      {!encoded && (running || encodeLog.length > 0) && (
        <div className="mt-8">
          <LiveDiagram />
        </div>
      )}

      {encoded && (
        <>
          <section aria-labelledby="enc-compare" className="mt-10">
            <Eyebrow index="A" tone="teal">
              Cover vs stego
            </Eyebrow>
            <h2 id="enc-compare" className="mt-2 text-[19px] font-normal text-fg">
              What hiding changed
            </h2>
            <p className="mt-1 max-w-3xl text-[13px] text-fg-2">
              {encoded.clipScale === 1
                ? 'Below 16.5 kHz the two are identical; the message replaced the cover only in the marked bands.'
                : `The message replaced the cover only in the marked bands; the whole file was also scaled by ${(20 * Math.log10(encoded.clipScale)).toFixed(2)} dB to avoid clipping.`}
            </p>
            <div className="mt-5 grid gap-4">
              <div className="grid items-center gap-3 sm:grid-cols-[5rem_1fr]">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">cover</span>
                <WaveformPlayer samples={encoded.stages.cover.samples} label="Original cover" color="fg" height={48} compact />
              </div>
              <div className="grid items-center gap-3 sm:grid-cols-[5rem_1fr]">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal">stego</span>
                <WaveformPlayer samples={encoded.stages.stego.samples} label="Encoded stego" color="teal" height={48} compact />
              </div>
            </div>
            <div className="mt-8" data-tour-target="enc-spectrum">
              <SpectrumAnalyzer output={encoded.stages.stego.samples} input={encoded.stages.cover.samples} layout={encoded.layout} outputLabel="stego" inputLabel="cover" initialZoom="hidden" height={340} />
            </div>
          </section>

          <section aria-label="FFT butterflies" data-tour-target="enc-butterfly" className="mt-14 border-t border-line pt-8">
            <Eyebrow index="B" tone="teal">
              The FFT
            </Eyebrow>
            <div className="mt-4">
              <ButterflyExplorer
                role="encoder"
                re={encoded.stages.secret.samples}
                im={encoded.stages.cover.samples}
                inputLabel={encoded.hasVoice ? 'Encoder input z = voice + j·cover' : 'Encoder input z = 0 + j·cover (text mode: the voice input is zero)'}
                stats={{ fftSize: encoded.fftSize, fftStages: Math.log2(encoded.fftSize), butterflyCount: (encoded.fftSize / 2) * Math.log2(encoded.fftSize), fftMs: encoded.log.find((t) => t.stage === 'fft')?.ms ?? null, kind: 'dit' }}
              />
            </div>
          </section>

          <section className="mt-14 border-t border-line pt-6">
            <button type="button" onClick={() => setExplore((v) => !v)} aria-expanded={explore} className="group flex w-full items-center justify-between gap-4 text-left">
              <span>
                <Eyebrow index="C" tone="teal">
                  Explore the pipeline
                </Eyebrow>
                <span className="mt-1 block text-[13px] text-fg-2">Step block by block through the encoder — listen to and inspect the signal after each operation.</span>
              </span>
              <ChevronDown className={cn('size-5 shrink-0 text-fg-3 transition-transform group-hover:text-fg', explore && 'rotate-180')} aria-hidden="true" />
            </button>
            <AnimatePresence initial={false}>
              {explore && (
                <motion.div key="explore" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} style={{ overflow: 'hidden' }}>
                  <div className="pt-6">
                    <Walkthrough enc={encoded} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        </>
      )}

      <BeginnerTour open={tourOpen && !!encoded} steps={TOUR} onClose={() => setTourOpen(false)} />
    </StageFrame>
  )
}
