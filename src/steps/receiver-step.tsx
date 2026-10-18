import { ArrowRight, Binary, KeyRound, RotateCcw, Upload, Workflow, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { loadClipFromFile } from '../audio/load-audio'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { ButterflyExplorer } from '../components/butterfly/butterfly-explorer'
import { useJourney } from '../components/channel/journey'
import { TransmissionAnimation } from '../components/channel/transmission-animation'
import { SpectrogramCanvas } from '../components/charts/spectrogram-canvas'
import { SpectrumAnalyzer } from '../components/charts/spectrum-analyzer'
import { ProcessLog } from '../components/diagram/process-log'
import { SignalDiagram, type NodeState } from '../components/diagram/signal-diagram'
import { useWalkthrough, WalkthroughControls } from '../components/diagram/walkthrough'
import { BeginnerTour, useStageTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { StageFrame } from '../components/layout/stage-frame'
import { PermutationView } from '../components/pipeline/permutation-view'
import { BitGrid, ConstellationPlot } from '../components/text-lane/text-lane-views'
import { KeyField } from '../components/ui/key-field'
import { Button, Eyebrow, Notice, Readout, Tabs, TabsContent, TabsList, cn, fmtMs } from '../components/ui/primitives'
import { spectrogram } from '../dsp/analysis'
import { computeLaneLayout } from '../dsp/bit-lane'
import { MAX_DURATION_S, SAMPLE_RATE } from '../dsp/constants'
import type { FftKind } from '../dsp/fft'
import { computeLayout } from '../dsp/spectral-ops'
import { fftSizeFor } from '../dsp/stego'
import { DECODER_EDGES, DECODER_NODE_STAGE, DECODER_NODES, DECODE_STEP_LABEL, DECODE_STEP_ORDER, decoderSteps } from '../pipeline/decoder-pipeline'
import { useStegoStore } from '../store/use-stego-store'
import type { DecodeOutput } from '../worker/protocol'
import { checkReceivedAudio, checkReceiverKey, recoveryVerdict } from './receiver-validation'
import { channelLabel, formatBytes, formatHz } from './sender-validation'

const TOUR: BeginnerTourStep[] = [
  { target: 'rx-file', title: 'Start with the file', text: 'The receiver has nothing but the audio file that arrived. Load it here — nothing is taken from the sender.' },
  { target: 'rx-key', title: 'Type the key', text: 'The key never travels with the file. Type the one the sender gave you; it is not filled in for you.' },
  { target: 'rx-decode', title: 'Decode', text: 'Decode, and the result is checked with AES-GCM. Nothing is presented as recovered until that check passes.' },
]

function Gate({ index, title, done, children, tourTarget }: { index: string; title: string; done?: boolean; children: ReactNode; tourTarget: string }) {
  return (
    <motion.section
      data-tour-target={tourTarget}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="border-t border-line pt-6"
    >
      <div className="flex items-baseline justify-between">
        <Eyebrow index={index} tone="teal">
          {title}
        </Eyebrow>
        {done && <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ok">✓ set</span>}
      </div>
      <div className="mt-4">{children}</div>
    </motion.section>
  )
}

/** Where the decoder will look, computed from this file's length exactly as decode() will. */
function bandMarks(length: number) {
  try {
    const n = fftSizeFor(length)
    const v = computeLayout(n, SAMPLE_RATE)
    const l = computeLaneLayout(n, SAMPLE_RATE)
    return [
      { hz: v.carrierLow * v.binHz, label: 'voice', color: '#4ea5ff' },
      { hz: l.start * l.binHz, label: 'text', color: '#20d6c7' },
    ]
  } catch {
    return []
  }
}

function DecoderWalkthrough({ dec, kind }: { dec: DecodeOutput; kind: FftKind }) {
  const steps = useMemo(() => decoderSteps(dec, kind), [dec, kind])
  const w = useWalkthrough(steps.length, dec)
  const step = steps[w.index]
  const states = useMemo(() => {
    const seen = new Set<string>()
    steps.slice(0, w.index).forEach((s) => s.nodes.forEach((id) => seen.add(id)))
    const st: Record<string, NodeState> = {}
    for (const n of DECODER_NODES) st[n.id] = step.nodes.includes(n.id) ? 'active' : seen.has(n.id) || n.id === 'received' ? 'done' : 'idle'
    return st
  }, [steps, step, w.index])
  const timings = new Map(dec.log.map((t) => [t.stage, t.ms]))
  const view = step.stage ? dec.stages[step.stage] : null
  const before = step.before ? dec.stages[step.before] : null

  return (
    <div>
      <div className="border-y border-line py-5">
        <SignalDiagram
          nodes={DECODER_NODES}
          edges={DECODER_EDGES}
          states={states}
          onSelect={(id) => {
            const i = steps.findIndex((s) => s.nodes.includes(id))
            if (i >= 0) w.go(i)
          }}
          rows={2}
          cols={9}
          label="Decoder block diagram"
        />
      </div>
      <div className="border-b border-line py-4">
        <WalkthroughControls w={w} label="Decoder walkthrough" />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step.id} className="pt-8" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
          <div className="grid gap-x-10 gap-y-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0">
              <Eyebrow index={String(w.index + 1).padStart(2, '0')} tone="teal">
                {step.timing ? `${DECODE_STEP_LABEL[step.timing]} · ${fmtMs(timings.get(step.timing) ?? 0)} ms measured` : 'input'}
              </Eyebrow>
              <h3 className="mt-2 text-[22px] font-light text-fg">{step.title}</h3>
              <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-fg-2">{step.body}</p>
            </div>
            {step.formula && <div className="self-start border-l border-teal/60 py-1 pl-4 font-mono text-[12px] text-fg">{step.formula}</div>}
          </div>
          {view && (
            <div className="mt-6 max-w-3xl">
              <WaveformPlayer samples={view.samples} label="Signal at this block" normalize={step.normalize} note={step.normalize ? 'loudness normalised for listening' : undefined} height={56} />
            </div>
          )}
          {view && (
            <div className="mt-8">
              <SpectrumAnalyzer output={view.samples} input={before?.samples ?? null} layout={dec.layout} outputLabel="after this block" inputLabel="entering" initialZoom={step.zoom ?? 'full'} />
            </div>
          )}
          {step.id === 'unpermute' && (
            <div className="mt-8">
              <PermutationView permutation={dec.permutation} caption="regenerated from the receiver key" />
            </div>
          )}
          {step.id === 'despread' && (
            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,18rem)_1fr]">
              <div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">BPSK constellation</div>
                <ConstellationPlot re={dec.text.softRe} im={dec.text.softIm} />
              </div>
              {/* the receiver never sees the sent bits, so no error marking here */}
              <BitGrid bits={dec.text.bits} title="Decided bits" />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function LiveDecoder() {
  const { decodeLog, busy } = useStegoStore()
  const done = new Set(decodeLog.map((t) => t.stage))
  const pending = DECODE_STEP_ORDER.find((s) => !done.has(s))
  const st: Record<string, NodeState> = {}
  for (const n of DECODER_NODES) {
    const stage = DECODER_NODE_STAGE[n.id]
    st[n.id] = stage === 'start' || done.has(stage as never) ? 'done' : busy === 'decode' && stage === pending ? 'running' : 'idle'
  }
  return (
    <div className="border-y border-line py-5">
      <SignalDiagram nodes={DECODER_NODES} edges={DECODER_EDGES} states={st} rows={2} cols={9} label="Decoder, live progress" />
    </div>
  )
}

export function ReceiverStep() {
  const { receivedFile, receivedOrigin, receiverKey, setReceiverKey, setReceivedFile, fftKind, decode, decoded, decodeLog, decodeError, busy, goTo, cancel, cancelled } = useStegoStore()
  const journey = useJourney('receive')
  const [tourOpen, setTourOpen] = useStageTour('receiver')
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [keyConfirmed, setKeyConfirmed] = useState(() => receiverKey.trim().length > 0 && !!decoded)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [tab, setTab] = useState('pipeline')

  useEffect(() => {
    if (!receiverKey) setKeyConfirmed(false)
  }, [receiverKey])

  const audioCheck = useMemo(() => checkReceivedAudio(receivedFile), [receivedFile])
  const keyCheck = checkReceiverKey(receiverKey)
  const audioReady = !!receivedFile && !audioCheck.error
  const keyReady = audioReady && keyConfirmed && !keyCheck.error
  const decoding = busy === 'decode'
  const spec = useMemo(() => (receivedFile && audioReady ? spectrogram(receivedFile.samples, SAMPLE_RATE, 1024, 320) : null), [receivedFile, audioReady])
  const marks = useMemo(() => (receivedFile ? bandMarks(receivedFile.samples.length) : []), [receivedFile])

  const accept = async (file: File) => {
    if (loading || decoding) return
    setLoading(true)
    setFileError(null)
    try {
      setReceivedFile(await loadClipFromFile(file), 'upload')
    } catch (e) {
      // a file that will not decode leaves any previous file in place, and says why
      setFileError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const confirmKey = () => {
    const c = checkReceiverKey(receiverKey)
    if (c.error) {
      setKeyError(c.error)
      setKeyConfirmed(false)
      return
    }
    setKeyError(null)
    setKeyConfirmed(true)
  }

  const verdict = decoded ? recoveryVerdict(decoded.text.status, decoded.text.content) : null
  const info = receivedFile?.source ?? null
  const origin = receivedOrigin === 'transfer-stego' ? 'delivered from Transfer · original stego' : receivedOrigin === 'transfer-channel' ? 'delivered from Transfer · channel output' : 'uploaded'

  const aside = (
    <>
      {(decoding || decodeLog.length > 0) && <ProcessLog order={DECODE_STEP_ORDER} labels={DECODE_STEP_LABEL} log={decodeLog} running={decoding} failed={!!decodeError} />}
      {decoded && (
        <dl>
          <Readout label="FFT" value={`radix-2 ${fftKind.toUpperCase()} · N = 2^${decoded.fftStages}`} />
          <Readout label="Butterflies" value={decoded.butterflyCount.toLocaleString('en-US')} />
          <Readout label="FFT time" value={`${decoded.fftMs.toFixed(1)} ms`} />
          <Readout label="Wall time" value={`${fmtMs(decoded.totalMs)} ms`} tone="ok" />
        </dl>
      )}
      <Button className="w-full" size="lg" onClick={() => goTo(4)} disabled={!decoded} icon={<ArrowRight className="size-4" aria-hidden="true" />}>
        Open the results
      </Button>
    </>
  )

  return (
    <StageFrame
      index="04"
      role="Decoding station"
      title="Receive"
      lead="Works on its own: a file and a key are all it uses. Nothing is borrowed from the sender — not the audio, not the key."
      aside={aside}
    >
      <TransmissionAnimation compact phase={journey.phase} noisy={journey.noisy} channelUnknown={journey.channelUnknown} senderLabel={journey.senderLabel} failure={verdict && !verdict.success ? verdict.title : undefined} />

      <Gate index="A" title="Received audio" done={audioReady} tourTarget="rx-file">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            if (!loading) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void accept(f)
          }}
          className={cn('border transition-colors', dragging ? 'border-teal bg-teal/5' : 'border-line bg-bg-2')}
        >
          {receivedFile && audioReady ? (
            <div className="p-4">
              <WaveformPlayer samples={receivedFile.samples} label={receivedFile.name} note={origin} height={64} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="grid-paper flex h-[150px] w-full flex-col items-center justify-center gap-1.5 text-center text-fg-3 transition-colors hover:text-fg-2"
            >
              <span className="text-[14px] text-fg-2">{loading ? 'Decoding the file…' : dragging ? 'Release to load' : 'Drop the stego WAV here, or click to choose it'}</span>
              <span className="font-mono text-[11px]">use the WAV exactly as exported · first {MAX_DURATION_S} s used</span>
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={loading || decoding} icon={<Upload className="size-3.5" aria-hidden="true" />}>
            {receivedFile ? 'Choose another file' : 'Choose file'}
          </Button>
          {receivedFile && (
            <Button
              variant="ghost"
              size="sm"
              disabled={decoding}
              onClick={() => {
                setReceivedFile(null)
                setFileError(null)
              }}
              icon={<RotateCcw className="size-3.5" aria-hidden="true" />}
            >
              Clear
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav"
            className="hidden"
            aria-label="Choose the received audio file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void accept(f)
            }}
          />
        </div>
        <div className="mt-3 space-y-2" aria-live="polite">
          {fileError && <Notice tone="error" title="Could not read that file">{fileError}</Notice>}
          {audioCheck.error && <Notice tone="error">{audioCheck.error}</Notice>}
          {audioCheck.warning && <Notice tone="warning">{audioCheck.warning}</Notice>}
          {info && info.format !== 'WAV' && audioReady && (
            <Notice tone="warning">This is a {info.format} file. Lossy formats usually remove the bands above 16 kHz that carry the message; decoding will show whether anything survived.</Notice>
          )}
        </div>
        {receivedFile && audioReady && (
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,16rem)_1fr]">
            <dl>
              <Readout label="Duration" value={`${receivedFile.duration.toFixed(2)} s`} />
              <Readout label="Sample rate" value={info?.sourceSampleRate ? formatHz(info.sourceSampleRate) : 'not stored'} />
              <Readout label="Channels" value={info ? channelLabel(info.channels) : 'mono'} />
              <Readout label="Format" value={info?.format ?? '—'} />
              <Readout label="Size" value={info ? formatBytes(info.bytes) : '—'} />
            </dl>
            {spec && <SpectrogramCanvas spec={spec} title="Spectrogram · where the decoder will look" height={150} marks={marks} />}
          </div>
        )}
      </Gate>

      <AnimatePresence initial={false}>
        {audioReady && (
          <Gate key="key" index="B" title="Receiver key" done={keyReady} tourTarget="rx-key">
            <KeyField
              id="rkey"
              label="Key from the sender"
              value={receiverKey}
              onChange={(v) => {
                setReceiverKey(v)
                setKeyError(null)
                setKeyConfirmed(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmKey()
              }}
              placeholder="type the shared key"
              invalid={!!keyError}
              describedBy="rkey-help"
              trailing={
                <Button variant={keyReady ? 'secondary' : 'primary'} onClick={confirmKey} disabled={!receiverKey.trim() || keyReady} icon={<KeyRound className="size-4" aria-hidden="true" />}>
                  {keyReady ? 'Key set' : 'Use key'}
                </Button>
              }
            />
            <p id="rkey-help" className="mt-2 text-[12px] leading-relaxed text-fg-3">
              Never filled in or checked against the sender. Whether it is right is decided by the decoder.
            </p>
            <div className="mt-2 space-y-2">
              {keyError && <Notice tone="error">{keyError}</Notice>}
              {keyCheck.warning && !keyError && <Notice tone="warning">{keyCheck.warning}</Notice>}
            </div>
          </Gate>
        )}

        {keyReady && (
          <Gate key="decode" index="C" title="Decoder" done={!!decoded} tourTarget="rx-decode">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-md text-[13px] text-fg-2">Runs the full decoder on this file with your key, then checks the result with AES-GCM before anything is shown.</p>
              <div className="flex gap-2">
                {decoding && (
                  <Button variant="secondary" size="lg" onClick={cancel} icon={<X className="size-4" aria-hidden="true" />}>
                    Cancel
                  </Button>
                )}
                <Button size="lg" onClick={() => void decode()} loading={decoding} disabled={decoding} icon={<Binary className="size-4" aria-hidden="true" />}>
                  {decoded ? 'Decode again' : 'Decode'}
                </Button>
              </div>
            </div>

            <div className="mt-5 space-y-3" aria-live="polite">
              {decodeError && (
                <Notice tone="error" title="The decoder could not process this file">
                  {decodeError}
                </Notice>
              )}
              {cancelled === 'decode' && !decoding && !decoded && <Notice tone="info">Decoding was cancelled. No result was produced.</Notice>}
              {verdict && decoded && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
                  <Notice tone={verdict.tone === 'ok' ? 'ok' : verdict.tone === 'bad' ? 'error' : 'warning'} title={verdict.title}>
                    {verdict.detail}
                    {verdict.success && decoded.text.text !== null && <span className="mt-2 block whitespace-pre-wrap break-words font-mono text-[14px] text-fg">{decoded.text.text}</span>}
                  </Notice>
                </motion.div>
              )}
            </div>
          </Gate>
        )}
      </AnimatePresence>

      {(decoding || (decodeLog.length > 0 && !decoded)) && (
        <div className="mt-10">
          <LiveDecoder />
        </div>
      )}

      {decoded && receivedFile && (
        <section className="mt-14" aria-label="Decoder internals">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList
              label="Decoder views"
              tabs={[
                { value: 'pipeline', label: 'Decoder walkthrough', icon: <Workflow className="size-3.5" aria-hidden="true" /> },
                { value: 'butterfly', label: 'FFT butterflies', icon: <Binary className="size-3.5" aria-hidden="true" /> },
              ]}
            />
            <TabsContent value="pipeline">
              <DecoderWalkthrough dec={decoded} kind={fftKind} />
            </TabsContent>
            <TabsContent value="butterfly">
              <ButterflyExplorer key={decoded.fftSize} role="decoder" re={receivedFile.samples} inputLabel="Received audio r[n]" stats={{ ...decoded, kind: fftKind }} />
            </TabsContent>
          </Tabs>
        </section>
      )}

      <BeginnerTour open={tourOpen} steps={TOUR} onClose={() => setTourOpen(false)} />
    </StageFrame>
  )
}
