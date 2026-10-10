import { ArrowRight, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { LineChart } from '../components/charts/line-chart'
import { BeginnerTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { PermutationView } from '../components/pipeline/permutation-view'
import { LaneStats } from '../components/text-lane/text-result'
import { BitGrid, CipherFrameView } from '../components/text-lane/text-lane-views'
import { PipelineFlow } from '../components/pipeline/pipeline-flow'
import { StageInspector } from '../components/pipeline/stage-inspector'
import { Button, Card, CardTitle, fmtDb, Metric } from '../components/ui/primitives'
import { ENCODE_EDGES, ENCODE_NODES } from '../pipeline/stage-meta'
import { useStegoStore } from '../store/use-stego-store'
import { useReveal } from './use-reveal'

const MAX_ORDER = Math.max(...ENCODE_NODES.map((n) => n.order))

const BEGINNER_HIDE_TOUR_STEPS: BeginnerTourStep[] = [
  {
    target: 'encode-overview',
    title: 'What are we doing?',
    text: 'We are hiding the secret information inside the cover audio.\n\nThe goal is to create a new audio signal that still sounds like the original, but now carries the hidden information.',
  },
  {
    target: 'frequency-spectrum',
    title: 'Why are we doing this?',
    text: 'The secret should not be obvious to someone listening to the audio.\n\nInstead of simply adding the secret as another audible sound, we embed information into selected parts of the audio spectrum.',
  },
  {
    target: 'fft-pipeline',
    title: 'How does it work?',
    text: 'First, we use the FFT (Fast Fourier Transform) to represent the audio in the frequency domain.\n\nThis lets us work with individual frequency components instead of only the waveform in time.\n\nThe hidden information is then embedded into a selected high-frequency region.',
  },
  {
    target: 'encode-action',
    title: 'Your turn',
    text: 'The system is ready to encode the secret.\n\nStart the encoding process and watch how the signal changes in the frequency domain.\n\nAfter encoding, we will inspect the result before sending it through the simulated channel.',
  },
]

export function EncodeStep() {
  const { encoded, key, goTo, uiMode } = useStegoStore()
  const [epoch, setEpoch] = useState(0)
  const revealed = useReveal(MAX_ORDER, encoded, epoch)
  const [selected, setSelected] = useState<string>('secret')
  const [followReveal, setFollowReveal] = useState(true)
  const [tourOpen, setTourOpen] = useState(uiMode === 'beginner')

  useEffect(() => {
    setTourOpen(uiMode === 'beginner')
  }, [uiMode])

  // While the pipeline lights up, the inspector follows the newest block on the secret path.
  useEffect(() => {
    if (!followReveal) return
    const latest = ENCODE_NODES.filter((n) => n.order === revealed && n.id !== 'cover' && n.id !== 'bandstop')[0]
    if (latest) setSelected(latest.id)
  }, [revealed, followReveal])

  const node = useMemo(() => ENCODE_NODES.find((n) => n.id === selected) ?? ENCODE_NODES[0], [selected])

  if (!encoded) return null
  const { stages, layout, metrics, permutation, firResponse, text } = encoded
  const noText = <p className="text-sm text-slate-400">No hidden text was entered on the Sender step, so the lane stays empty.</p>

  const extra =
    node.id === 'fir' ? (
      <div>
        <div className="mb-2 text-xs font-medium text-slate-300">FIR magnitude response |H(f)| (1023 taps, Hamming window)</div>
        <LineChart
          series={[{ x: firResponse.freqs, y: firResponse.magDb, color: '#a78bfa', label: '|H(f)|' }]}
          xDomain={[0, 6000]}
          yDomain={[-100, 5]}
          height={180}
          xFormat={(v) => (v / 1000).toFixed(1)}
        />
      </div>
    ) : node.id === 'permute' ? (
      <PermutationView permutation={permutation} keyLabel={key} />
    ) : node.id === 'text' || node.id === 'aes' ? (
      text ? <CipherFrameView cipher={text.cipher} plaintext={text.plaintext} /> : noText
    ) : node.id === 'spread' ? (
      text ? (
        <div className="space-y-3">
          <LaneStats info={text} />
          <BitGrid bits={text.bits} title="Transmitted bits (header outlined)" />
        </div>
      ) : (
        noText
      )
    ) : null

  return (
    <div className="space-y-6">
      <Card data-tour-target="encode-overview" className="border-cyan-400/20 bg-cyan-400/[0.04]">
        <CardTitle title="How did this work?" hint="Technical explanation" />
        <p className="text-sm leading-relaxed text-slate-300">
          The application transforms the audio into the frequency domain using FFT, places the hidden information in a high-frequency region, and converts the result back into audio. The detailed DSP visualisations below let you inspect every stage.
        </p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Cover vs stego SNR" value={fmtDb(metrics.coverSnrDb)} unit="dB" hint="How much the original audio changed" />
        <Metric label="Hidden band level" value={fmtDb(metrics.hiddenLevelDb)} unit="dB" tone="violet" hint="Energy of the secret relative to the stego file" />
        <Metric
          label="Carrier band"
          value={`${((layout.carrierLow * layout.binHz) / 1000).toFixed(1)}–${(((layout.carrierLow + layout.width) * layout.binHz) / 1000).toFixed(1)}`}
          unit="kHz"
          tone="emerald"
          hint={`${layout.width.toLocaleString('en-US')} FFT bins of ${layout.binHz.toFixed(3)} Hz`}
        />
        <Metric
          label="Encoding time"
          value={encoded.totalMs.toFixed(0)}
          unit="ms"
          tone="amber"
          hint={`N = ${layout.n.toLocaleString('en-US')} · DSP ${encoded.timings.dspMs.toFixed(0)} ms + plots ${encoded.timings.analysisMs.toFixed(0)} ms`}
        />
      </div>

      <div data-tour-target="fft-pipeline">
        <Card>
        <CardTitle
          icon={<Workflow className="size-4" />}
          title="Encoder block diagram"
          hint="Click any block to inspect and listen to the signal at that point."
          right={
            <Button variant="ghost" size="sm" onClick={() => {
                setFollowReveal(true)
                setEpoch((e) => e + 1)
              }}>
              Replay
            </Button>
          }
        />
        <PipelineFlow
          nodes={ENCODE_NODES}
          edges={ENCODE_EDGES}
          revealed={revealed}
          selectedId={selected}
          onSelect={(id) => {
            setFollowReveal(false)
            setSelected(id)
          }}
          height={400}
        />
        </Card>
      </div>

      <div data-tour-target="frequency-spectrum">
        <StageInspector node={node} views={stages} layout={layout} extra={extra} />
      </div>

      <Card className="ring-1 ring-emerald-400/30">
        <CardTitle title="Stego audio ready" hint="Play it: it should sound like the cover. Download it to send it as a normal WAV file." />
        <WaveformPlayer samples={stages.stego.samples} color="emerald" label="stego.wav" downloadName="stego.wav" height={72} />
      </Card>

      <div data-tour-target="encode-action" className="flex justify-end">
        <Button size="lg" onClick={() => goTo(2)} icon={<ArrowRight className="size-5" />}>
          Send the audio
        </Button>
      </div>
      <BeginnerTour open={uiMode === 'beginner' && tourOpen} steps={BEGINNER_HIDE_TOUR_STEPS} onClose={() => setTourOpen(false)} />
    </div>
  )
}
