import { ArrowRight, Download, FlaskConical, Radio, Send, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { useJourney } from '../components/channel/journey'
import { TransmissionAnimation } from '../components/channel/transmission-animation'
import { SpectrumAnalyzer } from '../components/charts/spectrum-analyzer'
import { BeginnerTour, useStageTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { StageFrame } from '../components/layout/stage-frame'
import { Button, Eyebrow, Metric, Notice, Readout, Segmented, Slider, Switch, cn, fmtDb } from '../components/ui/primitives'
import { downloadWav } from '../audio/load-audio'
import { SAMPLE_RATE } from '../dsp/constants'
import { CHANNEL_PRESETS, presetOf, useStegoStore, type ChannelPreset } from '../store/use-stego-store'
import type { StressResult } from '../worker/protocol'
import { formatBytes } from './sender-validation'

const TOUR: BeginnerTourStep[] = [
  { target: 'channel-anim', title: 'The journey', text: 'The file travels from sender to receiver. The packets move only while the file is actually being sent through the channel.' },
  { target: 'export', title: 'Send the real file', text: 'Download stego.wav and send it as a file. That is all the receiver needs — plus the key, sent separately.' },
  { target: 'channel-path', title: 'Or test a channel', text: 'Switch on the effects a real channel might apply, then run it. The received audio is genuinely altered.' },
  { target: 'channel-result', title: 'Compare TX and RX', text: 'See how much each hidden band was damaged, then hand either file to the receiver.' },
]

interface BlockProps {
  label: string
  sub: string
  on: boolean
  first?: boolean
  last?: boolean
  children?: ReactNode
}

/** One block of the transmission path, with its control directly underneath. */
function PathBlock({ label, sub, on, first, last, children }: BlockProps) {
  return (
    <div className="relative min-w-0">
      <div className="relative flex items-center">
        {!first && <span aria-hidden="true" className={cn('h-px w-4 shrink-0 transition-colors sm:w-6', on ? 'bg-teal' : 'bg-line-2')} />}
        <motion.div
          initial={false}
          animate={{ borderColor: on ? 'var(--color-teal)' : 'var(--color-line-2)', backgroundColor: on ? 'rgba(32,214,199,0.08)' : 'rgba(10,28,44,0)' }}
          transition={{ duration: 0.25 }}
          className="min-w-0 grow border px-3 py-2"
        >
          <div className={cn('truncate text-[13px]', on ? 'text-fg' : 'text-fg-3')}>{label}</div>
          <div className="truncate font-mono text-[10px] text-fg-3">{on ? sub : 'bypassed'}</div>
        </motion.div>
        {!last && <span aria-hidden="true" className={cn('h-px w-4 shrink-0 transition-colors sm:w-6', on ? 'bg-teal' : 'bg-line-2')} />}
      </div>
      {children && <div className="mt-4 space-y-4 px-1 sm:pl-6">{children}</div>}
    </div>
  )
}

/** From the original channel step: the transmission animation runs for at least this long. */
const MIN_ANIMATION_MS = 2200

const STATUS_LABEL: Record<StressResult['status'], { text: string; tone: string }> = {
  ok: { text: 'recovered · authenticated', tone: 'text-ok' },
  'voice-verified': { text: 'key verified · voice recovered', tone: 'text-ok' },
  'auth-failed': { text: 'frame found · authentication failed', tone: 'text-err' },
  'no-payload': { text: 'lost · no frame', tone: 'text-err' },
}

export function ChannelStep() {
  const { encoded, channel, setChannel, applyPreset, transmit, transmitted, busy, channelError, deliver, goTo, receivedOrigin, stress, stressProgress, stressError, runStressTest, cancel } = useStegoStore()
  const [tourOpen, setTourOpen] = useStageTour('channel')
  const [animating, setAnimating] = useState(false)
  useEffect(() => {
    if (!animating) return
    const t = setTimeout(() => setAnimating(false), MIN_ANIMATION_MS)
    return () => clearTimeout(t)
  }, [animating])
  const journey = useJourney('transfer', animating)
  if (!encoded) return null
  const preset = presetOf(channel)
  const stego = encoded.stages.stego.samples
  const noisy = channel.noiseSnrDb !== null
  const lp = channel.lowpassHz ?? null
  const anyEffect = noisy || channel.gainDb !== 0 || lp !== null || channel.quantize16
  const sending = busy === 'channel' || animating

  const handOver = async (which: 'stego' | 'channel') => {
    setAnimating(true)
    const t0 = performance.now()
    const ok = await deliver(which)
    // let the transmission play for its original minimum length before switching to the receiver
    if (ok) setTimeout(() => goTo(3), Math.max(0, MIN_ANIMATION_MS - (performance.now() - t0)))
  }

  const send = async () => {
    setAnimating(true)
    await transmit()
  }

  const aside = (
    <div data-tour-target="export" className="space-y-5">
      <div>
        <Eyebrow index="A" tone="teal">
          Export the original
        </Eyebrow>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          The exact stego file, as 16-bit PCM WAV. Send it as a file attachment; keep it WAV — MP3, AAC or voice-note apps remove the bands above 16 kHz that carry the message.
        </p>
        <dl className="mt-3">
          <Readout label="File" value="stego.wav" />
          <Readout label="Size" value={formatBytes(44 + stego.length * 2)} />
          <Readout label="Duration" value={`${(stego.length / SAMPLE_RATE).toFixed(2)} s`} />
          <Readout label="Format" value="PCM 16-bit · mono · 44.1 kHz" />
        </dl>
        <div className="mt-4 space-y-2">
          <Button className="w-full" onClick={() => downloadWav(stego, 'stego.wav')} icon={<Download className="size-4" aria-hidden="true" />}>
            Download stego.wav
          </Button>
          <Button className="w-full" variant="secondary" onClick={() => void handOver('stego')} loading={busy === 'deliver'} disabled={!!busy} icon={<ArrowRight className="size-4" aria-hidden="true" />}>
            Deliver unchanged
          </Button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-fg-3">“Deliver” writes the same WAV bytes and opens them on the Receiver as an uploaded file would be. The key is not passed along.</p>
      </div>
    </div>
  )

  return (
    <StageFrame
      index="03"
      role="Transmission path"
      title="Transfer"
      lead="The receiver needs only the file and the key. Export the stego file as it is, or first put it through a simulated channel and see what survives."
      aside={aside}
    >
      <div data-tour-target="channel-anim">
        <TransmissionAnimation phase={journey.phase} noisy={journey.noisy} />
      </div>

      <section data-tour-target="channel-path" aria-labelledby="channel-title" className="mt-10">
        <Eyebrow index="B" tone="teal">
          Channel simulator
        </Eyebrow>
        <h2 id="channel-title" className="mt-2 text-[19px] font-normal text-fg">
          What happens on the way
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-2">Effects are applied in this order, to the real samples. A bypassed block does nothing. Lossy formats and aggressive filtering can destroy the hidden data.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">Preset</span>
          <Segmented<ChannelPreset | 'custom'>
            label="Channel preset"
            value={preset ?? 'custom'}
            onChange={(v) => v !== 'custom' && applyPreset(v)}
            options={[
              ...(Object.keys(CHANNEL_PRESETS) as ChannelPreset[]).map((id) => ({ value: id, label: CHANNEL_PRESETS[id].label })),
              ...(preset ? [] : [{ value: 'custom' as const, label: 'Custom' }]),
            ]}
          />
        </div>

        <div className="mt-6 grid gap-y-6 md:grid-cols-4">
          <PathBlock label="Low-pass" sub={lp ? `${(lp / 1000).toFixed(1)} kHz brick-wall` : ''} on={lp !== null} first>
            <Switch checked={lp !== null} onChange={(v) => setChannel({ lowpassHz: v ? 16000 : null })} label="Lossy-codec cut-off" hint="Models MP3/AAC removing high frequencies." />
            <Slider label="Cut-off" value={lp ?? 16000} min={8000} max={21000} step={250} disabled={lp === null} onChange={(v) => setChannel({ lowpassHz: v })} format={(v) => `${(v / 1000).toFixed(2)} kHz`} />
          </PathBlock>
          <PathBlock label="Gain" sub={`${channel.gainDb > 0 ? '+' : ''}${channel.gainDb} dB`} on={channel.gainDb !== 0}>
            <Slider label="Volume change" value={channel.gainDb} min={-20} max={6} step={1} onChange={(v) => setChannel({ gainDb: v })} format={(v) => `${v > 0 ? '+' : ''}${v} dB`} />
          </PathBlock>
          <PathBlock label="AWGN" sub={noisy ? `SNR ${channel.noiseSnrDb} dB` : ''} on={noisy}>
            <Switch checked={noisy} onChange={(v) => setChannel({ noiseSnrDb: v ? 30 : null })} label="Additive noise" hint="White Gaussian; new seed every run." />
            <Slider label="Signal-to-noise" value={channel.noiseSnrDb ?? 30} min={0} max={60} step={1} disabled={!noisy} onChange={(v) => setChannel({ noiseSnrDb: v })} format={(v) => `${v} dB`} />
          </PathBlock>
          <PathBlock label="16-bit PCM" sub="clip + round" on={channel.quantize16} last>
            <Switch checked={channel.quantize16} onChange={(v) => setChannel({ quantize16: v })} label="Quantise to 16 bits" hint="Off: delivered as 32-bit float WAV." />
          </PathBlock>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={() => void send()} loading={sending} disabled={!!busy} icon={<Send className="size-4" aria-hidden="true" />}>
            {transmitted ? 'Run channel again' : 'Run channel'}
          </Button>
          {!anyEffect && <span className="text-[13px] text-fg-3">Every block is bypassed — the output will equal the input.</span>}
          {transmitted && <span className="font-mono text-[11px] text-fg-3">changing a setting clears this result</span>}
        </div>
        {channelError && (
          <Notice tone="error" className="mt-4" title="Channel failed">
            {channelError}
          </Notice>
        )}
      </section>

      <section data-tour-target="channel-result" aria-labelledby="channel-result-title" className="mt-12 border-t border-line pt-8">
        <h2 id="channel-result-title" className="sr-only">
          Channel result
        </h2>
        <div className="space-y-5">
          <div className="grid items-center gap-3 sm:grid-cols-[4.5rem_1fr]">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">cover</span>
            <WaveformPlayer samples={encoded.stages.cover.samples} label="Original cover — not sent" color="fg" height={44} compact />
          </div>
          <div className="grid items-center gap-3 sm:grid-cols-[4.5rem_1fr]">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">TX</span>
            <WaveformPlayer samples={stego} label="stego.wav — encoded, as sent" color="blue" height={52} compact />
          </div>
          <div className="grid items-center gap-3 sm:grid-cols-[4.5rem_1fr]">
            <span className={cn('font-mono text-[11px] uppercase tracking-[0.14em]', transmitted ? 'text-teal' : 'text-fg-3')}>RX</span>
            {transmitted ? (
              <WaveformPlayer samples={transmitted.received.samples} label="received.wav — channel-modified" color="teal" height={52} compact downloadName="received.wav" />
            ) : (
              <div className="flex h-[52px] items-center border border-dashed border-line px-4 text-[13px] text-fg-3">{sending ? 'Running the channel…' : 'Run the channel to produce the received file.'}</div>
            )}
          </div>
        </div>

        {transmitted && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="mt-8 grid grid-cols-1 gap-6 border-y border-line py-5 sm:grid-cols-3">
              <Metric label="Broadband SNR" value={fmtDb(transmitted.channelSnrDb)} unit="dB" hint="RX vs TX, whole file" />
              {encoded.hasVoice ? (
                <Metric label="Voice-band SNR" value={fmtDb(transmitted.voiceBandSnrDb)} unit="dB" tone={transmitted.voiceBandSnrDb < 10 ? 'warn' : 'fg'} hint="inside the voice carrier" />
              ) : (
                <Metric label="Voice-band SNR" value="—" hint="no voice in this file, so not meaningful" />
              )}
              <Metric label="Text-lane SNR" value={fmtDb(transmitted.textLaneSnrDb)} unit="dB" tone={transmitted.textLaneSnrDb < 0 ? 'warn' : 'fg'} hint={encoded.hasVoice ? 'key token frame, before 12 dB despreading gain' : 'before 12 dB despreading gain'} />
            </div>
            <p className="mt-3 text-[12px] text-fg-3">These numbers describe damage. Whether the message survives is only known after decoding.</p>

            <div className="mt-8">
              <SpectrumAnalyzer output={transmitted.received.samples} input={stego} layout={encoded.layout} outputLabel="RX" inputLabel="TX" height={300} initialZoom={lp !== null ? 'full' : 'hidden'} />
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button onClick={() => void handOver('channel')} loading={busy === 'deliver'} disabled={!!busy} icon={<Radio className="size-4" aria-hidden="true" />}>
                Deliver channel output to receiver
              </Button>
              <span className="text-[12px] text-fg-3">{transmitted.params.quantize16 ? 'as a 16-bit WAV' : 'as a 32-bit float WAV'}</span>
            </div>
          </motion.div>
        )}

        {receivedOrigin && receivedOrigin !== 'upload' && (
          <p className="mt-6 font-mono text-[11px] text-ok">
            Receiver currently holds the {receivedOrigin === 'transfer-stego' ? 'original stego file' : 'channel output'}.
          </p>
        )}
      </section>
      <section aria-labelledby="stress-title" className="mt-12 border-t border-line pt-8">
        <Eyebrow index="C" tone="teal">
          Stress test
        </Eyebrow>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="stress-title" className="text-[19px] font-normal text-fg">
              Does it survive?
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] text-fg-2">Runs each preset through the real channel and decoder with your sender key, inside the worker. The key is not stored or shown.</p>
          </div>
          {busy === 'stress' ? (
            <Button variant="secondary" onClick={cancel} icon={<X className="size-4" aria-hidden="true" />}>
              Cancel · {stressProgress}/{Object.keys(CHANNEL_PRESETS).length}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void runStressTest()} disabled={!!busy} icon={<FlaskConical className="size-4" aria-hidden="true" />}>
              {stress ? 'Run again' : 'Run stress test'}
            </Button>
          )}
        </div>
        {stressError && (
          <Notice tone="error" className="mt-4" title="Stress test failed">
            {stressError}
          </Notice>
        )}
        {stress && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">
                  <th className="py-2 pr-4 font-normal">Scenario</th>
                  <th className="py-2 pr-4 font-normal">Outcome</th>
                  {encoded.hasVoice && <th className="py-2 pr-4 text-right font-normal">Voice band SNR</th>}
                  <th className="py-2 pr-4 text-right font-normal">Text lane SNR</th>
                  {encoded.hasVoice && <th className="py-2 text-right font-normal">Voice corr.</th>}
                </tr>
              </thead>
              <tbody>
                {stress.map((r) => (
                  <tr key={r.id} className="border-b border-line text-[13px]">
                    <td className="py-2.5 pr-4 text-fg">{r.label}</td>
                    <td className={cn('py-2.5 pr-4 font-mono text-[12px]', STATUS_LABEL[r.status].tone)}>{STATUS_LABEL[r.status].text}</td>
                    {encoded.hasVoice && <td className="py-2.5 pr-4 text-right font-mono text-[12px] text-fg-2">{fmtDb(r.voiceBandSnrDb)} dB</td>}
                    <td className="py-2.5 pr-4 text-right font-mono text-[12px] text-fg-2">{fmtDb(r.textLaneSnrDb)} dB</td>
                    {encoded.hasVoice && <td className="py-2.5 text-right font-mono text-[12px] text-fg-2">{r.voiceCorrelation === null ? '—' : r.voiceCorrelation.toFixed(3)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 font-mono text-[11px] text-fg-3">Noisy uses a fixed noise seed so results repeat. “Authenticated” is the AES-GCM result, not an estimate.</p>
          </div>
        )}
      </section>

      <BeginnerTour open={tourOpen} steps={TOUR} onClose={() => setTourOpen(false)} />
    </StageFrame>
  )
}
