import { ArrowLeft, Check, ChevronDown, Copy, Download, FileJson, RotateCcw, ShieldCheck, ShieldOff, ShieldX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { downloadBlob, downloadText, downloadWav } from '../audio/load-audio'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { useJourney } from '../components/channel/journey'
import { TransmissionAnimation } from '../components/channel/transmission-animation'
import { SpectrogramCanvas, specMax } from '../components/charts/spectrogram-canvas'
import { BeginnerTour, useStageTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { StageFrame } from '../components/layout/stage-frame'
import { BitGrid, ConstellationPlot } from '../components/text-lane/text-lane-views'
import { Button, Eyebrow, Metric, Notice, Readout, cn, fmtDb, fmtMs } from '../components/ui/primitives'
import { computeLaneLayout, payloadCapacityBytes } from '../dsp/bit-lane'
import { SAMPLE_RATE } from '../dsp/constants'
import { CRYPTO_OVERHEAD } from '../dsp/crypto'
import { fftSizeFor } from '../dsp/stego'
import { useStegoStore } from '../store/use-stego-store'
import type { TextDecodeInfo } from '../worker/protocol'
import { recoveryVerdict, type Verification } from './receiver-validation'

const TOUR: BeginnerTourStep[] = [
  { target: 'result-answer', title: 'The answer', text: 'Only what the decoder recovered and AES-GCM verified is shown as recovered, with copy and download actions.' },
  { target: 'result-details', title: 'Technical details', text: 'Measured numbers, the wrong-key control experiment and, if this browser also made the file, a sender-vs-receiver comparison.' },
]

/** Copies with the async Clipboard API, falling back to a hidden textarea where it is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

const STATUS_WORD: Record<TextDecodeInfo['status'], string> = {
  ok: 'authenticated',
  'voice-verified': 'key token authenticated',
  'auth-failed': 'tag rejected',
  'no-payload': 'no frame',
}

const VERIFICATION: Record<Verification, { icon: typeof ShieldCheck; label: string; tone: string }> = {
  verified: { icon: ShieldCheck, label: 'AES-GCM verification succeeded', tone: 'text-ok' },
  failed: { icon: ShieldX, label: 'AES-GCM verification failed', tone: 'text-err' },
  unavailable: { icon: ShieldOff, label: 'Verification unavailable — no frame found', tone: 'text-warn' },
}

function Disclosure({ title, hint, children, tourTarget, defaultOpen = false }: { title: string; hint: string; children: ReactNode; tourTarget?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section data-tour-target={tourTarget} className="border-t border-line pt-5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="group flex w-full items-center justify-between gap-4 text-left">
        <span>
          <span className="block text-[15px] text-fg group-hover:text-teal">{title}</span>
          <span className="mt-0.5 block text-[12px] text-fg-3">{hint}</span>
        </span>
        <ChevronDown className={cn('size-5 shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28 }} style={{ overflow: 'hidden' }}>
            <div className="pb-2 pt-6">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

export function OutputStep() {
  const { decoded, receivedFile, receivedOrigin, transmitted, fftKind, encoded, comparison, compare, stress, goTo, resetSession } = useStegoStore()
  const [tourOpen, setTourOpen] = useStageTour('output')
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const journey = useJourney('receive')

  // sender-side comparison only when this session also encoded; the worker decides whether the file is linked
  useEffect(() => {
    if (decoded && encoded) void compare()
  }, [decoded, encoded, compare])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(t)
  }, [copied])

  if (!decoded || !receivedFile) return null
  const t = decoded.text
  const verdict = recoveryVerdict(t.status, t.content)
  const Shield = VERIFICATION[verdict.verification].icon
  const hasVoice = t.content === 'voice' || t.content === 'voice+text'
  const linked = comparison?.linked ?? false
  const viaChannel = receivedOrigin === 'transfer-channel' && transmitted ? transmitted : null
  let laneCapacity: number | null = null
  try {
    laneCapacity = payloadCapacityBytes(computeLaneLayout(fftSizeFor(receivedFile.samples.length), SAMPLE_RATE)) - CRYPTO_OVERHEAD
  } catch {
    laneCapacity = null
  }

  const exportReport = () => {
    // measured values and settings only — never the key
    const report = {
      tool: 'SpectraHide',
      generated: new Date().toISOString(),
      file: { name: receivedFile.name, origin: receivedOrigin, samples: receivedFile.samples.length, durationS: receivedFile.duration, format: receivedFile.source?.format ?? null, bytes: receivedFile.source?.bytes ?? null },
      verification: { method: 'AES-256-GCM (PBKDF2-SHA256 key)', status: verdict.verification, frame: t.content, decoderStatus: t.status },
      payload: {
        text: verdict.success && t.text !== null ? { bytes: new TextEncoder().encode(t.text).length, text: t.text } : null,
        voice: hasVoice ? { present: true, carrierLevelDb: decoded.carrierLevelDb, keyVerified: t.status === 'voice-verified' || t.status === 'ok', audioAuthenticated: false } : null,
      },
      capacity: { textLaneBytes: laneCapacity },
      decoder: { fft: `radix-2 ${fftKind}`, fftSize: decoded.fftSize, butterflies: decoded.butterflyCount, fftMs: decoded.fftMs, totalMs: decoded.totalMs, stages: decoded.log },
      channel: viaChannel ? { params: viaChannel.params, broadbandSnrDb: viaChannel.channelSnrDb, voiceBandSnrDb: hasVoice ? viaChannel.voiceBandSnrDb : null, textLaneSnrDb: viaChannel.textLaneSnrDb } : null,
      wrongKeyControl: { decoderStatus: decoded.wrongKey.text.status },
      labComparison: linked && comparison ? { stegoCorrelation: comparison.stegoCorrelation, coverSnrDb: comparison.coverSnrDb, voice: comparison.voice, ber: comparison.ber } : null,
      stressTest: linked && stress ? stress.map((r) => ({ scenario: r.label, params: r.params, status: r.status, voiceBandSnrDb: encoded?.hasVoice ? r.voiceBandSnrDb : null, textLaneSnrDb: r.textLaneSnrDb, voiceCorrelation: r.voiceCorrelation })) : null,
    }
    const json = JSON.stringify(report, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 2)
    downloadBlob(new Blob([json], { type: 'application/json' }), 'spectrahide-report.json')
  }

  const aside = (
    <>
      <dl>
        <Readout label="Verification" value={verdict.verification} tone={verdict.verification === 'verified' ? 'ok' : verdict.verification === 'failed' ? 'err' : 'warn'} />
        <Readout label="Payload" value={t.content === 'voice+text' ? 'voice + text' : t.content ?? 'unknown'} />
        <Readout label="Decode time" value={`${fmtMs(decoded.totalMs)} ms`} />
      </dl>
      <div className="space-y-2">
        <Button className="w-full" variant="secondary" onClick={exportReport} icon={<FileJson className="size-4" aria-hidden="true" />}>
          Export report (JSON)
        </Button>
        <Button className="w-full" variant="ghost" onClick={() => goTo(3)} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
          Back to receiver
        </Button>
        <Button className="w-full" variant="ghost" onClick={resetSession} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
          New session
        </Button>
      </div>
    </>
  )

  return (
    <StageFrame index="05" role="Analysis report" title="Results" lead="Computed from the received file and the key you typed — nothing else." aside={aside}>
      <TransmissionAnimation compact phase={journey.phase} noisy={journey.noisy} channelUnknown={journey.channelUnknown} senderLabel={journey.senderLabel} />

      <section data-tour-target="result-answer" aria-labelledby="verdict" className="mt-10">
        <div className={cn('flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]', VERIFICATION[verdict.verification].tone)}>
          <Shield className="size-4" aria-hidden="true" />
          {VERIFICATION[verdict.verification].label}
        </div>
        <h2 id="verdict" className="mt-3 text-[28px] font-light leading-tight text-fg sm:text-[36px]">
          {verdict.title}
        </h2>
        <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-fg-2">{verdict.detail}</p>

        {verdict.success && t.text !== null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="mt-8 border-l-2 border-teal py-1 pl-6">
            <Eyebrow tone="teal">Recovered text · {new TextEncoder().encode(t.text).length} bytes</Eyebrow>
            <p className="mt-4 whitespace-pre-wrap break-words font-mono text-[22px] leading-relaxed text-fg sm:text-[26px]">{t.text}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => setCopied((await copyText(t.text ?? '')) ? 'ok' : 'fail')}
                icon={copied === 'ok' ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              >
                {copied === 'ok' ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadText(t.text ?? '', 'recovered-message.txt')} icon={<Download className="size-3.5" aria-hidden="true" />}>
                Download .txt
              </Button>
              <span className="sr-only" aria-live="polite">
                {copied === 'ok' ? 'Copied to clipboard' : copied === 'fail' ? 'Copy failed' : ''}
              </span>
            </div>
            {copied === 'fail' && <p className="mt-2 text-[12px] text-err">The browser blocked clipboard access — select the text and copy it manually.</p>}
          </motion.div>
        )}

        {verdict.success && hasVoice && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} className="mt-8 max-w-3xl border-l-2 border-ok py-1 pl-6">
            <Eyebrow tone="ok">Recovered voice</Eyebrow>
            <div className="mt-4">
              <WaveformPlayer samples={decoded.stages.recovered.samples} label="recovered-voice.wav" note="band-limited 300–3400 Hz · normalised to 0.9 peak" color="ok" height={80} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => downloadWav(decoded.stages.recovered.samples, 'recovered-voice.wav')} icon={<Download className="size-3.5" aria-hidden="true" />}>
                Download WAV
              </Button>
              <span className="text-[12px] text-fg-3">The key was verified; the audio itself is analogue and can only be judged by listening.</span>
            </div>
          </motion.div>
        )}

        {!verdict.success && (
          <div className="mt-8 max-w-3xl">
            <Eyebrow>What to try</Eyebrow>
            <ol className="mt-3 space-y-2 text-[14px] text-fg-2">
              {verdict.actions.map((a, i) => (
                <li key={a} className="flex gap-3">
                  <span className="font-mono text-[12px] text-fg-3">{i + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => goTo(3)} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
                Try another key or file
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className="mt-14 space-y-6">
        {verdict.verification === 'unavailable' && (
          <Disclosure title="Listen to the voice band anyway" hint="Unverified. Original-format voice-only files carry no frame, so this may be the message — or noise if the key or file is wrong.">
            <div className="max-w-3xl space-y-3">
              <WaveformPlayer samples={decoded.stages.recovered.samples} label="Voice band after un-scrambling with your key" note="unverified" color="warn" height={64} />
              <Button size="sm" variant="ghost" onClick={() => downloadWav(decoded.stages.recovered.samples, 'voice-band-unverified.wav')} icon={<Download className="size-3.5" aria-hidden="true" />}>
                Download WAV (unverified)
              </Button>
            </div>
          </Disclosure>
        )}

        <Disclosure tourTarget="result-details" title="Technical details" hint="Measured values, the wrong-key control and the sender-vs-receiver comparison.">
          <div className="space-y-12">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Metric label="Decoder status" value={STATUS_WORD[t.status]} tone={verdict.success ? 'ok' : 'warn'} />
              <Metric label="Bits read" value={t.bits.length.toLocaleString('en-US')} hint="header + payload" />
              <Metric label="Carrier level" value={fmtDb(decoded.carrierLevelDb)} unit="dB" hint="voice band vs whole file" />
              <Metric label="Text capacity" value={laneCapacity === null ? '—' : String(Math.max(0, laneCapacity))} unit="bytes" hint="of a file this long" />
              <Metric label="FFT" value={`2^${decoded.fftStages}`} hint={`radix-2 ${fftKind.toUpperCase()} · ${decoded.fftMs.toFixed(1)} ms`} />
              <Metric label="Decode total" value={fmtMs(decoded.totalMs)} unit="ms" />
              {viaChannel && <Metric label="Channel SNR" value={fmtDb(viaChannel.channelSnrDb)} unit="dB" hint="this file went through the simulator" />}
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,18rem)_1fr]">
              <div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">BPSK constellation</div>
                <ConstellationPlot re={t.softRe} im={t.softIm} />
              </div>
              <BitGrid bits={t.bits} reference={linked ? (encoded?.text?.bits ?? null) : null} title={linked ? 'Received bits vs sent' : 'Decided bits'} />
            </div>

            <div>
              <Eyebrow index="C">Control experiment · deliberately wrong key</Eyebrow>
              <p className="mt-2 max-w-3xl text-[13px] text-fg-2">
                The same file decoded with your key plus one extra character: <span className="font-mono text-fg">{STATUS_WORD[decoded.wrongKey.text.status]}</span>.
              </p>
              {hasVoice && (
                <div className="mt-3 max-w-3xl">
                  <WaveformPlayer samples={decoded.wrongKey.recovered.samples} label="Voice band with the wrong key" note="normalised" color="err" height={44} compact />
                </div>
              )}
            </div>

            <div>
              <Eyebrow index="L">Sender vs receiver</Eyebrow>
              {!encoded ? (
                <p className="mt-2 max-w-3xl text-[13px] text-fg-3">This browser did not create the file, so there is no original to compare with — the normal case for a real receiver.</p>
              ) : !comparison ? (
                <p className="mt-2 font-mono text-[12px] text-fg-3">comparing…</p>
              ) : !linked ? (
                <p className="mt-2 max-w-3xl text-[13px] text-fg-2">
                  The received file is not derived from this session’s stego ({comparison.stegoCorrelation === null ? 'different length' : `correlation ${comparison.stegoCorrelation.toFixed(3)}`}), so sender-side metrics would be meaningless and are not shown.
                </p>
              ) : (
                <div className="mt-4 space-y-8">
                  <p className="max-w-3xl text-[13px] text-fg-2">This file matches the stego output encoded in this session (correlation {comparison.stegoCorrelation?.toFixed(4)}), so it is compared with the originals still held on the sender side.</p>
                  <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                    {comparison.coverSnrDb !== null && <Metric label="Cover → stego" value={fmtDb(comparison.coverSnrDb)} unit="dB SNR" />}
                    {comparison.voice && <Metric label="Voice SNR" value={fmtDb(comparison.voice.snrDb)} unit="dB" tone="ok" hint="vs band-limited original" />}
                    {comparison.voice && <Metric label="Segmental SNR" value={fmtDb(comparison.voice.segSnrDb)} unit="dB" />}
                    {comparison.voice && <Metric label="Correlation" value={comparison.voice.correlation.toFixed(3)} />}
                    {comparison.ber && <Metric label="Bit error rate" value={comparison.ber.ber === 0 ? '0' : comparison.ber.ber.toExponential(1)} tone={comparison.ber.errors ? 'err' : 'ok'} hint={`${comparison.ber.errors} of ${comparison.ber.compared} bits`} />}
                  </div>
                  {encoded.hasVoice && hasVoice && (
                    <div className="grid gap-6 md:grid-cols-2">
                      <SpectrogramCanvas spec={encoded.stages['secret-bandlimited'].spec} title="Original voice (band-limited)" height={140} dbMax={specMax(encoded.stages['secret-bandlimited'].spec)} />
                      <SpectrogramCanvas spec={decoded.stages.recovered.spec} title="Recovered voice" height={140} />
                    </div>
                  )}
                  <div className="grid gap-6 md:grid-cols-2">
                    <SpectrogramCanvas spec={encoded.stages.cover.spec} title="Original cover" height={150} dbMax={specMax(encoded.stages.cover.spec)} />
                    <SpectrogramCanvas spec={decoded.stages.received.spec} title="Received file" height={150} dbMax={specMax(encoded.stages.cover.spec)} />
                  </div>
                </div>
              )}
            </div>
            {!verdict.success && t.status === 'auth-failed' && (
              <Notice tone="info">An authentication failure does not always mean the key is wrong: damaged or re-encoded audio flips bits, and AES-GCM rejects those too.</Notice>
            )}
          </div>
        </Disclosure>
      </div>
      <BeginnerTour open={tourOpen} steps={TOUR} onClose={() => setTourOpen(false)} />
    </StageFrame>
  )
}
