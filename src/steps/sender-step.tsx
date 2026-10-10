import { ArrowRight, Dices, Inbox, KeyRound, Mic, Music } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { loadClipFromFile } from '../audio/load-audio'
import { AudioSourceCard } from '../components/audio/audio-source-card'
import { BeginnerTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { HiddenTextCard, textCapacity } from '../components/text-lane/hidden-text-card'
import { utf8Length } from '../dsp/crypto'
import { Button, Card, CardTitle, Slider } from '../components/ui/primitives'
import { useStegoStore } from '../store/use-stego-store'

function randomKey(): string {
  const words = ['nyquist', 'fourier', 'butterfly', 'twiddle', 'aliasing', 'hilbert', 'cepstrum', 'parseval']
  const w = words[Math.floor(Math.random() * words.length)]
  return `${w}-${Math.floor(1000 + Math.random() * 9000)}`
}

const BEGINNER_TOUR_STEPS: BeginnerTourStep[] = [
  { target: 'cover-audio', title: 'Choose your cover audio', text: 'This is the normal audio that everyone will hear. It becomes the signal that carries the hidden information.' },
  { target: 'secret-audio', title: 'Choose your secret audio', text: 'This is the voice you want to hide inside the cover audio.' },
  { target: 'secret-key', title: 'Set your secret key', text: 'The same key is needed later to recover the hidden information.' },
  { target: 'embedding-strength', title: 'Choose the embedding strength', text: 'This controls how strongly the hidden signal is added to the cover audio.' },
  { target: 'encode-action', title: "You're ready to encode", text: "You've selected the signals and key. Continue when you're ready for the next stage." },
]

export function SenderStep() {
  const { cover, secret, key, strengthDb, busy, uiMode, setCover, setSecret, setKey, setStrengthDb, setError, encode, goTo, setReceivedFile, hiddenText, setHiddenText } =
    useStegoStore()
  const capacity = textCapacity(cover)
  const textTooLong = capacity !== null && utf8Length(hiddenText) > capacity
  const receivedRef = useRef<HTMLInputElement>(null)
  const [tourOpen, setTourOpen] = useState(uiMode === 'beginner')

  useEffect(() => {
    setTourOpen(uiMode === 'beginner')
  }, [uiMode])

  const openReceived = async (file: File) => {
    try {
      setReceivedFile(await loadClipFromFile(file))
      goTo(3)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const secretWarning =
    cover && secret && secret.duration > cover.duration
      ? `The secret (${secret.duration.toFixed(1)} s) is longer than the cover (${cover.duration.toFixed(1)} s) and will be cut to fit.`
      : null

  const run = async () => {
    if (uiMode === 'beginner' && !secret) {
      setError('Your cover audio is ready. Add the secret voice message below before continuing.')
      return
    }
    if (await encode()) goTo(1)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div data-tour-target="cover-audio">
          <AudioSourceCard
          title={uiMode === 'beginner' ? 'Upload cover audio' : 'Audio everyone will hear'}
          hint={uiMode === 'beginner' ? 'This is the normal audio an outside listener will hear.' : 'Choose the normal cover audio. This is the cover signal used by the steganography system.'}
          icon={<Music className="size-4" />}
          clip={cover}
          onClip={setCover}
          onError={setError}
          demoUrl={`${import.meta.env.BASE_URL}samples/cover-demo.wav`}
          demoName="Demo cover — synth groove (11.5 s)"
          color="cyan"
          />
        </div>
        <div data-tour-target="secret-audio">
          <AudioSourceCard
          title="Voice message to hide"
          hint="Record or upload the secret voice. Speech is band-limited to 300–3400 Hz before frequency-domain embedding."
          icon={<Mic className="size-4" />}
          clip={secret}
          onClip={setSecret}
          onError={setError}
          demoUrl={`${import.meta.env.BASE_URL}samples/secret-demo.wav`}
          demoName="Demo secret — synthesized voice"
          allowRecord
          color="violet"
          warning={secretWarning}
          />
        </div>
      </div>

      <Card data-tour-target="secret-key">
        <CardTitle
          icon={<KeyRound className="size-4" />}
          title="Secret key and hiding strength"
          hint="The receiver needs the same key. It controls keyed sub-band scrambling so the hidden voice can be recovered."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs text-slate-400" htmlFor="key">
              Secret key
            </label>
            <div className="flex gap-2">
              <input
                id="key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full rounded-xl bg-black/30 px-3 py-2 font-mono text-sm text-amber-200 outline-none ring-1 ring-white/10 focus:ring-amber-300/60"
                placeholder="type a key…"
              />
              <Button variant="secondary" onClick={() => setKey(randomKey())} icon={<Dices className="size-4" />}>
                Random
              </Button>
            </div>
          </div>
          <div data-tour-target="embedding-strength">
            <Slider
              label="How strongly should the secret be hidden?"
              value={strengthDb}
              min={-40}
              max={-10}
              step={1}
              onChange={setStrengthDb}
              format={(v) => `${v} dB`}
            />
          </div>
          <p className="-mt-3 text-xs text-slate-500">Stronger embedding can improve recovery, but makes the hidden signal easier to detect.</p>
        </div>
      </Card>

      <HiddenTextCard text={hiddenText} onChange={setHiddenText} cover={cover} />

      <div data-tour-target="encode-action" className="flex flex-wrap items-center justify-between gap-4">
        <button
          onClick={() => receivedRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-400 ring-1 ring-white/10 transition hover:text-white"
        >
          <Inbox className="size-4" /> Received a stego file? Decode it directly
        </button>
        <input
          ref={receivedRef}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-label="Received stego file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void openReceived(f)
          }}
        />
        <Button size="lg" onClick={run} loading={busy === 'encode'} disabled={!cover || !key.trim() || textTooLong || (uiMode === 'dsp' && !secret)} icon={<ArrowRight className="size-5" />}>
          {uiMode === 'beginner' ? 'Continue →' : 'Hide secret in audio'}
        </Button>
      </div>
      <BeginnerTour open={uiMode === 'beginner' && tourOpen} steps={BEGINNER_TOUR_STEPS} onClose={() => setTourOpen(false)} />
    </div>
  )
}
