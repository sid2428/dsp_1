import { ArrowRight, Dices, Inbox, KeyRound, Mic, Music } from 'lucide-react'
import { useRef } from 'react'
import { loadClipFromFile } from '../audio/load-audio'
import { AudioSourceCard } from '../components/audio/audio-source-card'
import { HiddenTextCard, textCapacity } from '../components/text-lane/hidden-text-card'
import { utf8Length } from '../dsp/crypto'
import { Button, Card, CardTitle, Slider } from '../components/ui/primitives'
import { useStegoStore } from '../store/use-stego-store'

function randomKey(): string {
  const words = ['nyquist', 'fourier', 'butterfly', 'twiddle', 'aliasing', 'hilbert', 'cepstrum', 'parseval']
  const w = words[Math.floor(Math.random() * words.length)]
  return `${w}-${Math.floor(1000 + Math.random() * 9000)}`
}

export function SenderStep() {
  const { cover, secret, key, strengthDb, busy, setCover, setSecret, setKey, setStrengthDb, setError, encode, goTo, setReceivedFile, hiddenText, setHiddenText } =
    useStegoStore()
  const capacity = textCapacity(cover)
  const textTooLong = capacity !== null && utf8Length(hiddenText) > capacity
  const receivedRef = useRef<HTMLInputElement>(null)

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
    if (await encode()) goTo(1)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <AudioSourceCard
          title="1 · Cover music"
          hint="The innocent track everyone will hear. Rich, wide-band music works best."
          icon={<Music className="size-4" />}
          clip={cover}
          onClip={setCover}
          onError={setError}
          demoUrl={`${import.meta.env.BASE_URL}samples/cover-demo.wav`}
          demoName="Demo cover — synth groove (11.5 s)"
          color="cyan"
        />
        <AudioSourceCard
          title="2 · Secret voice message"
          hint="Speech to hide. Record yourself or upload a clip; 300–3400 Hz is kept."
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

      <Card>
        <CardTitle
          icon={<KeyRound className="size-4" />}
          title="3 · Shared secret key & embedding strength"
          hint="The key seeds the sub-band shuffle. The receiver needs the same key."
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
          <Slider
            label="Hidden band level relative to cover (lower = stealthier, higher = more robust)"
            value={strengthDb}
            min={-40}
            max={-10}
            step={1}
            onChange={setStrengthDb}
            format={(v) => `${v} dB`}
          />
        </div>
      </Card>

      <HiddenTextCard text={hiddenText} onChange={setHiddenText} cover={cover} />

      <div className="flex flex-wrap items-center justify-between gap-4">
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
        <Button size="lg" onClick={run} loading={busy === 'encode'} disabled={!cover || !secret || !key.trim() || textTooLong} icon={<ArrowRight className="size-5" />}>
          Encode secret into cover
        </Button>
      </div>
    </div>
  )
}
