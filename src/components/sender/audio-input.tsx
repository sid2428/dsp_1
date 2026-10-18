import { Mic, RotateCcw, Sparkles, Square, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { loadClipFromFile, loadClipFromUrl, MicRecorder, type AudioClip } from '../../audio/load-audio'
import { isTranscriptionSupported, SpeechTranscriber, TRANSCRIPTION_UNSUPPORTED_MESSAGE } from '../../audio/speech-to-text'
import { MAX_DURATION_S, SAMPLE_RATE } from '../../dsp/constants'
import { channelLabel, formatBytes, formatHz, isSilent } from '../../steps/sender-validation'
import { WaveformPlayer, type WaveColor } from '../audio/waveform-player'
import { Button, Eyebrow, Notice, cn } from '../ui/primitives'

interface AudioInputProps {
  index: string
  eyebrow: string
  title: string
  hint: ReactNode
  clip: AudioClip | null
  onClip: (clip: AudioClip | null) => void
  demoUrl: string
  demoName: string
  allowRecord?: boolean
  color?: WaveColor
  warning?: string | null
  /** When set, a recording is also run through live speech recognition and the result is offered here. */
  onTranscript?: (text: string) => void
  tourTarget?: string
  children?: ReactNode
}

/** Elapsed time and input level of a live recording, updated per animation frame without re-rendering React. */
function RecordingMeter({ recorder }: { recorder: MicRecorder }) {
  const barRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const level = Math.min(1, recorder.level() * 4)
      if (barRef.current) barRef.current.style.transform = `scaleX(${level})`
      if (timeRef.current) timeRef.current.textContent = ((performance.now() - recorder.startedAt) / 1000).toFixed(1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [recorder])
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between font-mono text-[12px]">
        <span className="text-err">
          <span className="rec-blink">●</span> REC
        </span>
        <span className="text-fg">
          <span ref={timeRef}>0.0</span> s <span className="text-fg-3">/ max {MAX_DURATION_S} s</span>
        </span>
      </div>
      <div className="relative h-2 bg-bg" role="presentation">
        <div ref={barRef} className="absolute inset-y-0 left-0 w-full origin-left bg-teal" style={{ transform: 'scaleX(0)' }} />
        {[0.25, 0.5, 0.75].map((t) => (
          <span key={t} className="absolute inset-y-0 w-px bg-panel" style={{ left: `${t * 100}%` }} />
        ))}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">microphone input level (RMS)</div>
    </div>
  )
}

export function AudioInput({ index, eyebrow, title, hint, clip, onClip, demoUrl, demoName, allowRecord, color = 'teal', warning, onTranscript, tourTarget, children }: AudioInputProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MicRecorder | null>(null)
  const transcriberRef = useRef<SpeechTranscriber | null>(null)
  const [recorder, setRecorder] = useState<MicRecorder | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [heard, setHeard] = useState('')
  const [transcript, setTranscript] = useState<string | null>(null)
  const [speechNote, setSpeechNote] = useState<string | null>(null)
  /** The clip that was just replaced or cleared, so an accidental overwrite can be undone. */
  const [previous, setPrevious] = useState<AudioClip | null>(null)
  const recording = recorder !== null
  const transcribes = !!onTranscript && !!allowRecord
  const speechSupported = transcribes && isTranscriptionSupported()

  // Leaving the stage mid-recording must not keep the microphone open.
  useEffect(
    () => () => {
      transcriberRef.current?.abort()
      recorderRef.current?.discard()
    },
    [],
  )

  const load = async (fn: () => Promise<AudioClip>) => {
    if (loading) return
    const replacing = clip
    setLoading(true)
    setError(null)
    try {
      const next = await fn()
      onClip(next)
      setPrevious(replacing)
    } catch (e) {
      // a failed load leaves the current clip untouched
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const startRecording = async () => {
    setError(null)
    setTranscript(null)
    setSpeechNote(null)
    setHeard('')
    const rec = new MicRecorder()
    try {
      await rec.start()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    recorderRef.current = rec
    setRecorder(rec)
    if (!transcribes) return
    if (!speechSupported) {
      setSpeechNote(TRANSCRIPTION_UNSUPPORTED_MESSAGE)
      return
    }
    const t = new SpeechTranscriber()
    if (t.start({ onUpdate: (settled, pending) => setHeard(`${settled} ${pending}`.trim()), onError: setSpeechNote })) transcriberRef.current = t
    else setSpeechNote(TRANSCRIPTION_UNSUPPORTED_MESSAGE)
  }

  const stopRecording = async () => {
    const rec = recorderRef.current
    const t = transcriberRef.current
    recorderRef.current = null
    transcriberRef.current = null
    setRecorder(null)
    // recognition must never hold up (or sink) the recording itself
    const spoken = t ? await t.stop().catch(() => '') : ''
    if (rec) await load(() => rec.stop())
    setHeard('')
    if (spoken) setTranscript(spoken)
  }

  const clear = () => {
    if (!clip) return
    setPrevious(clip)
    setTranscript(null)
    onClip(null)
  }

  const undo = () => {
    if (!previous) return
    const current = clip
    onClip(previous)
    setPrevious(current)
  }

  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (recording || loading) return
    const f = e.dataTransfer.files?.[0]
    if (f) void load(() => loadClipFromFile(f))
  }

  const info = clip?.source ?? null
  const silent = !!clip && clip.samples.length > 0 && isSilent(clip)
  const rate = !info?.sourceSampleRate
    ? `${formatHz(SAMPLE_RATE)} (source rate not stored)`
    : info.sourceSampleRate === SAMPLE_RATE
      ? formatHz(SAMPLE_RATE)
      : `${formatHz(info.sourceSampleRate)} → ${formatHz(SAMPLE_RATE)}`

  return (
    <section data-tour-target={tourTarget} aria-labelledby={`${index}-title`} className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow index={index} tone="teal">
            {eyebrow}
          </Eyebrow>
          <h2 id={`${index}-title`} className="mt-2 text-[19px] font-normal text-fg">
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{hint}</p>
        </div>
        <span className={cn('mt-1 shrink-0 font-mono text-[11px] uppercase tracking-[0.12em]', clip ? 'text-ok' : 'text-fg-3')}>{clip ? 'loaded' : 'empty'}</span>
      </div>

      <div
        className={cn('relative mt-5 border transition-colors', dragging ? 'border-teal bg-teal/5' : 'border-line bg-bg-2')}
        onDragOver={(e) => {
          e.preventDefault()
          if (!recording && !loading) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <AnimatePresence mode="wait" initial={false}>
          {recording && recorder ? (
            <motion.div key="rec" className="p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <RecordingMeter recorder={recorder} />
              {speechSupported && (
                <>
                  <p className="mt-4 min-h-10 text-[13px] leading-relaxed text-fg-2" aria-live="polite">
                    {heard || <span className="text-fg-3">Listening for speech…</span>}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-fg-3">transcription by the browser’s speech service (Chrome sends the audio to it)</p>
                </>
              )}
            </motion.div>
          ) : clip ? (
            <motion.div key={`clip-${clip.name}-${clip.samples.length}`} className="p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <WaveformPlayer samples={clip.samples} label={clip.name} color={color} normalize height={64} note={clip.source?.kind === 'mic' ? 'recorded' : undefined} />
            </motion.div>
          ) : (
            <motion.button
              key="empty"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="grid-paper flex h-[124px] w-full flex-col items-center justify-center gap-1.5 text-center text-fg-3 transition-colors hover:text-fg-2"
            >
              <span className="text-[13px] text-fg-2">{loading ? 'Decoding audio…' : dragging ? 'Release to load the file' : 'Drop an audio file here, or click to browse'}</span>
              <span className="font-mono text-[11px]">WAV recommended · other formats only if this browser can decode them · first {MAX_DURATION_S} s used</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" aria-hidden="true" />} onClick={() => fileRef.current?.click()} disabled={loading || recording}>
          {clip ? 'Replace' : 'Upload'}
        </Button>
        {allowRecord && (
          <Button
            variant={recording ? 'danger' : 'secondary'}
            size="sm"
            icon={recording ? <Square className="size-3.5" aria-hidden="true" /> : <Mic className="size-3.5" aria-hidden="true" />}
            onClick={() => void (recording ? stopRecording() : startRecording())}
            disabled={loading}
          >
            {recording ? 'Stop' : 'Record'}
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<Sparkles className="size-3.5" aria-hidden="true" />} onClick={() => void load(() => loadClipFromUrl(demoUrl, demoName, 'demo'))} disabled={loading || recording}>
          Demo clip
        </Button>
        {clip && !recording && (
          <Button variant="ghost" size="sm" icon={<X className="size-3.5" aria-hidden="true" />} onClick={clear} disabled={loading}>
            Clear
          </Button>
        )}
        {previous && !recording && (
          <button type="button" onClick={undo} className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-3 hover:text-fg">
            <RotateCcw className="size-3" aria-hidden="true" /> undo · restore “{previous.name.length > 24 ? `${previous.name.slice(0, 24)}…` : previous.name}”
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.webm"
          className="hidden"
          aria-label={`${title}: choose an audio file`}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void load(() => loadClipFromFile(f))
          }}
        />
      </div>

      {clip && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-3">
          {[
            ['Duration', `${clip.duration.toFixed(2)} s${clip.truncated ? ' (trimmed)' : ''}`],
            ['Sample rate', rate],
            ['Channels', info ? `${channelLabel(info.channels)}${info.channels > 1 ? ' → mono' : ''}` : 'mono'],
            ['Format', info?.format ?? 'decoded audio'],
            ['File size', info ? formatBytes(info.bytes) : '—'],
            ['Samples', clip.samples.length.toLocaleString('en-US')],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">{k}</dt>
              <dd className="mt-0.5 truncate font-mono text-[12px] text-fg" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 space-y-2" aria-live="polite">
        {error && <Notice tone="error">{error}</Notice>}
        {silent && <Notice tone="error">This audio is completely silent, so it cannot be used. Load a clip with sound.</Notice>}
        {clip?.truncated && <Notice tone="warning">Only the first {MAX_DURATION_S} s are used — the FFT is capped at 2²⁰ points.</Notice>}
        {warning && <Notice tone="warning">{warning}</Notice>}
        {speechNote && <Notice tone="info">{speechNote}</Notice>}
        {transcript && onTranscript && (
          <Notice tone="info" title="Transcript from the browser’s speech recogniser">
            <span className="block whitespace-pre-wrap font-mono text-fg">{transcript}</span>
            <span className="mt-1 block text-[12px] text-fg-3">The voice recording is what gets hidden. You can instead send this transcript as a text message — it opens in the editor for review.</span>
            <span className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onTranscript(transcript)
                  setTranscript(null)
                }}
              >
                Send as text instead
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setTranscript(null)}>
                Dismiss
              </Button>
            </span>
          </Notice>
        )}
      </div>

      {children}
    </section>
  )
}
