import { ArrowRight, Binary, CheckCircle2, KeyRound, Radio, Upload, Workflow, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadClipFromFile } from '../audio/load-audio'
import { ButterflyExplorer } from '../components/butterfly/butterfly-explorer'
import { BeginnerTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { PipelineFlow } from '../components/pipeline/pipeline-flow'
import { PermutationView } from '../components/pipeline/permutation-view'
import { TextDecodePanel, TextStatusBanner } from '../components/text-lane/text-result'
import { BitGrid, ConstellationPlot } from '../components/text-lane/text-lane-views'
import { StageInspector } from '../components/pipeline/stage-inspector'
import { Badge, Button, Card, CardTitle, Segmented, Tabs, TabsContent, TabsList } from '../components/ui/primitives'
import { DECODE_EDGES, DECODE_NODES } from '../pipeline/stage-meta'
import { useStegoStore } from '../store/use-stego-store'
import { useReveal } from './use-reveal'

const MAX_ORDER = Math.max(...DECODE_NODES.map((n) => n.order))

const BEGINNER_RECEIVER_TOUR_STEPS: BeginnerTourStep[] = [
  { target: 'receiver-overview', title: 'What are we doing?', text: 'We are now trying to recover the hidden information from the received audio.\n\nThe receiver only has the transmitted audio, so it must locate and decode the hidden signal.' },
  { target: 'receiver-key', title: 'Why do we need the key?', text: 'The hidden information was protected using the shared secret key.\n\nThe receiver must use the correct key to recover the hidden information correctly.' },
  { target: 'receiver-fft', title: 'How does decoding work?', text: 'The receiver uses the FFT to examine the received signal in the frequency domain.\n\nIt locates the hidden frequency region, extracts the encoded information and reconstructs the original secret.' },
  { target: 'receiver-action', title: 'Your turn', text: 'Enter the receiver key and start decoding.\n\nThen we will compare the recovered result with the original secret.' },
]

export function ReceiverStep() {
  const s = useStegoStore()
  const { decoded, receiverKey, key, fftKind, busy, receivedFile, transmitted } = s
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState('butterfly')
  const [epoch, setEpoch] = useState(0)
  const revealed = useReveal(MAX_ORDER, tab === 'pipeline' ? decoded : null, epoch)
  const [selected, setSelected] = useState('recovered')
  const [tourOpen, setTourOpen] = useState(s.uiMode === 'beginner')
  const node = useMemo(() => DECODE_NODES.find((n) => n.id === selected) ?? DECODE_NODES[0], [selected])

  useEffect(() => {
    setTourOpen(s.uiMode === 'beginner')
  }, [s.uiMode])

  useEffect(() => {
    const latest = DECODE_NODES.find((n) => n.order === revealed)
    if (latest) setSelected(latest.id)
  }, [revealed])

  const keyMatches = receiverKey === key
  const source = receivedFile ? `file: ${receivedFile.name}` : transmitted ? 'simulated channel' : 'nothing yet'
  const received = receivedFile?.samples ?? transmitted?.received.samples ?? null

  return (
    <div className="space-y-6">
      <Card data-tour-target="receiver-overview">
        <CardTitle icon={<Radio className="size-4" />} title="Technical decoder settings" hint={`Received audio: ${source}`} />
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr_auto] lg:items-end">
          <div data-tour-target="receiver-key" className="space-y-2">
            <label htmlFor="rkey" className="flex items-center gap-2 text-xs text-slate-400">
              <KeyRound className="size-3.5" /> Receiver’s key
              {!s.encoded ? null : keyMatches ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <CheckCircle2 className="size-3.5" /> matches sender
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-rose-300">
                  <XCircle className="size-3.5" /> differs from sender
                </span>
              )}
            </label>
            <input
              id="rkey"
              value={receiverKey}
              onChange={(e) => s.setReceiverKey(e.target.value)}
              className="w-full rounded-xl bg-black/30 px-3 py-2 font-mono text-sm text-amber-200 outline-none ring-1 ring-white/10 focus:ring-amber-300/60"
            />
          </div>
          <div data-tour-target="receiver-fft" className="space-y-2">
            <div className="text-xs text-slate-400">FFT algorithm <span className="text-slate-500">(used by the decoder)</span></div>
            <Segmented
              value={fftKind}
              onChange={s.setFftKind}
              options={[
                { value: 'dit', label: 'Radix-2 DIT' },
                { value: 'dif', label: 'Radix-2 DIF' },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              Load stego WAV
            </Button>
            <Button data-tour-target="receiver-action" onClick={() => void s.decode()} loading={busy === 'decode'} disabled={!received || !receiverKey.trim()} icon={<Binary className="size-4" />}>
              Recover hidden message
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                s.setReceivedFile(await loadClipFromFile(f))
              } catch (err) {
                s.setError(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </div>
        {receivedFile && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Badge>{receivedFile.name}</Badge>
            <button className="text-cyan-300 hover:underline" onClick={() => s.setReceivedFile(null)}>
              use the simulated channel instead
            </button>
          </div>
        )}
      </Card>

      {decoded && received && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList
            tabs={[
              { value: 'butterfly', label: 'FFT butterflies', icon: <Binary className="size-4" /> },
              { value: 'pipeline', label: 'Decoder pipeline', icon: <Workflow className="size-4" /> },
            ]}
          />
          <TabsContent value="butterfly">
            <ButterflyExplorer
              key={`${fftKind}-${decoded.fftSize}`}
              received={received}
              initialKind={fftKind}
              stats={{ ...decoded, kind: fftKind }}
            />
          </TabsContent>
          <TabsContent value="pipeline" className="space-y-6">
            <Card>
              <CardTitle
                icon={<Workflow className="size-4" />}
                title="Decoder block diagram"
                hint="The exact mirror of the encoder. Click a block to hear the signal there."
                right={
                  <Button variant="ghost" size="sm" onClick={() => setEpoch((e) => e + 1)}>
                    Replay
                  </Button>
                }
              />
              <PipelineFlow nodes={DECODE_NODES} edges={DECODE_EDGES} revealed={revealed} selectedId={selected} onSelect={setSelected} height={400} />
            </Card>
            <StageInspector
              node={node}
              views={decoded.stages}
              layout={decoded.layout}
              extra={
                node.id === 'unpermute' ? (
                  <PermutationView permutation={decoded.permutation} keyLabel={receiverKey} />
                ) : node.id === 'despread' ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
                    <div className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
                      <div className="mb-1 text-[11px] text-slate-400">Despread symbols (BPSK constellation)</div>
                      <ConstellationPlot re={decoded.text.softRe} im={decoded.text.softIm} />
                    </div>
                    <BitGrid bits={decoded.text.bits} reference={s.encoded?.text?.bits} title="Decided bits" />
                  </div>
                ) : node.id === 'decrypt' ? (
                  <TextStatusBanner info={decoded.text} />
                ) : node.id === 'message' ? (
                  <TextDecodePanel info={decoded.text} sent={s.encoded?.text ?? null} />
                ) : null
              }
            />
          </TabsContent>
        </Tabs>
      )}

      <div className="flex justify-end">
        <Button size="lg" onClick={() => s.goTo(4)} disabled={!decoded} icon={<ArrowRight className="size-5" />}>
          Hear the recovered secret
        </Button>
      </div>
      <BeginnerTour open={s.uiMode === 'beginner' && tourOpen} steps={BEGINNER_RECEIVER_TOUR_STEPS} onClose={() => setTourOpen(false)} />
    </div>
  )
}
