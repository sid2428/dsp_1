import { ArrowRight, Check, Circle, Dices, Inbox } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import { AudioInput } from '../components/sender/audio-input'
import { CoverSpectrum } from '../components/sender/cover-spectrum'
import { MessageComposer } from '../components/sender/message-composer'
import { BeginnerTour, useStageTour, type BeginnerTourStep } from '../components/layout/beginner-tour'
import { StageFrame } from '../components/layout/stage-frame'
import { Button, Eyebrow, Segmented, cn } from '../components/ui/primitives'
import { KeyField } from '../components/ui/key-field'
import { CARRIER_LOW_HZ, GUARD_HZ, NUM_SUBBANDS, SECRET_HIGH_HZ, SECRET_LOW_HZ } from '../dsp/constants'
import { useStegoStore } from '../store/use-stego-store'
import { validateSender, type PayloadMode } from './sender-validation'

const WORDS = ['nyquist', 'fourier', 'butterfly', 'twiddle', 'aliasing', 'hilbert', 'cepstrum', 'parseval', 'hamming', 'kaiser', 'laplace', 'wiener']

/** Three words and four digits from the browser's CSPRNG. */
function randomKey(): string {
  const r = crypto.getRandomValues(new Uint32Array(4))
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${WORDS[r[2] % WORDS.length]}-${(r[3] % 9000) + 1000}`
}

const VOICE_LOW_KHZ = CARRIER_LOW_HZ / 1000
const VOICE_HIGH_KHZ = (CARRIER_LOW_HZ + SECRET_HIGH_HZ + GUARD_HZ - (SECRET_LOW_HZ - GUARD_HZ)) / 1000

const TOUR: BeginnerTourStep[] = [
  { target: 'cover-audio', title: 'The carrier', text: 'This is the ordinary audio anyone can hear. Upload a track, or try the demo clip.' },
  { target: 'message', title: 'The message', text: 'Choose one payload: a text message or a voice recording. It travels near the top of the spectrum, where it is hard to hear.' },
  { target: 'secret-key', title: 'The shared key', text: 'The key scrambles the voice and encrypts the text. The receiver must type the same key — it is never sent with the file.' },
  { target: 'encode-action', title: 'Encode', text: 'When every required input is valid, continue to watch the real encoder process your audio.' },
]

function CheckRow({ done, optional, label, detail }: { done: boolean; optional?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center', done ? 'text-ok' : 'text-fg-3')}>
        {done ? <Check className="size-4" aria-hidden="true" /> : <Circle className="size-3" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-fg">
          {label}
          {optional && <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">optional</span>}
        </span>
        <span className="block font-mono text-[11px] text-fg-3">{detail}</span>
      </span>
      <span className="sr-only">{done ? 'ready' : 'not ready'}</span>
    </li>
  )
}

export function SenderStep() {
  const { cover, secret, key, hiddenText, payloadMode, setPayloadMode, setCover, setSecret, setKey, setHiddenText, encode, goTo, busy, uiMode } = useStegoStore()
  const [tourOpen, setTourOpen] = useStageTour('sender')
  const status = useMemo(
    () => validateSender({ cover, secret, key, hiddenText, mode: payloadMode, beginner: uiMode === 'beginner' }),
    [cover, secret, key, hiddenText, payloadMode, uiMode],
  )
  const blocked = (prefix: string) => status.blocking.some((i) => i.id.startsWith(prefix))
  const hasText = hiddenText.trim().length > 0
  const keyIssue = status.issues.find((i) => i.id.startsWith('key-'))
  const secretWarning = status.warnings.find((i) => i.id === 'secret-longer')?.detail ?? null

  const run = () => {
    if (!status.ready || busy) return
    goTo(1)
    void encode()
  }

  const payloadDetail =
    payloadMode === 'text' ? (hasText ? `text · ${new TextEncoder().encode(hiddenText).length} bytes` : 'type the text') : secret ? `voice · ${secret.duration.toFixed(1)} s` : 'record or upload a voice'

  const aside = (
    <>
      <div data-tour-target="encode-action">
        <Eyebrow>Preflight</Eyebrow>
        <ul className="mt-2" aria-describedby="sender-blocking">
          <CheckRow done={!!cover && !blocked('cover-')} label="Carrier audio" detail={cover ? `${cover.duration.toFixed(2)} s loaded` : 'required'} />
          <CheckRow
            done={!blocked('secret-') && !blocked('text-')}
            label="Secret message"
            detail={payloadDetail}
          />
          <CheckRow done={!blocked('key-')} label="Shared key" detail={key.trim() ? `${[...key].length} characters` : 'required'} />
        </ul>
        {status.blocking.length > 0 && (
          <ul id="sender-blocking" className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-fg-2">
            {status.blocking.map((i) => (
              <li key={i.id} className="border-l border-warn pl-2.5">
                {i.detail}
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-5 w-full" size="lg" onClick={run} disabled={!status.ready} loading={busy === 'encode'} icon={<ArrowRight className="size-4" aria-hidden="true" />}>
          Continue to encode
        </Button>
      </div>
      <button type="button" onClick={() => goTo(3)} className="group flex w-full items-start gap-3 border-t border-line pt-4 text-left">
        <Inbox className="mt-0.5 size-4 shrink-0 text-fg-3 group-hover:text-teal" aria-hidden="true" />
        <span>
          <span className="block text-[13px] text-fg group-hover:text-teal">Received a file instead?</span>
          <span className="block text-[12px] text-fg-3">The Receiver works on its own — open it directly.</span>
        </span>
      </button>
    </>
  )

  return (
    <StageFrame
      index="01"
      role="Recording studio"
      title="Compose the transmission"
      lead="Pick the audio everyone will hear, then the message only the key holder should get. Both leave as a single ordinary-sounding WAV file."
      aside={aside}
    >
      <div className="grid gap-y-12 lg:grid-cols-2 lg:gap-x-0">
        <div className="min-w-0 lg:border-r lg:border-line lg:pr-10">
          <AudioInput
            index="A"
            eyebrow="Carrier · audible"
            title="Cover audio"
            hint="Music or speech that anyone may hear. Longer covers carry more text."
            clip={cover}
            onClip={setCover}
            demoUrl={`${import.meta.env.BASE_URL}samples/cover-demo.wav`}
            demoName="Demo cover — synth groove"
            color="fg"
            tourTarget="cover-audio"
          >
            {cover && !status.blocking.some((i) => i.id === 'cover-layout') && <CoverSpectrum cover={cover} />}
          </AudioInput>
        </div>

        <div className="min-w-0 lg:pl-10" data-tour-target="message">
          <Eyebrow index="B" tone="teal">
            Message · hidden
          </Eyebrow>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[19px] font-normal text-fg">Secret message</h2>
            <Segmented<PayloadMode>
              label="Payload type"
              value={payloadMode}
              onChange={setPayloadMode}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'voice', label: 'Voice' },
              ]}
            />
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-2">
            {payloadMode === 'text'
              ? 'Encrypted with AES-256-GCM, so the receiver can verify the key and that the text arrived intact.'
              : `The voice itself is hidden and recovered as audio (band-limited to ${SECRET_LOW_HZ}–${SECRET_HIGH_HZ} Hz). A small AES-GCM key token travels with it so the receiver can verify the key.`}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={payloadMode} className="mt-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
              {payloadMode === 'text' ? (
                <MessageComposer text={hiddenText} onChange={setHiddenText} cover={cover} />
              ) : (
                <AudioInput
                  index="B.1"
                  eyebrow={`Voice · carried at ${VOICE_LOW_KHZ}–${VOICE_HIGH_KHZ} kHz`}
                  title="Voice message"
                  hint="Record with the microphone or upload a recording. It is scrambled with the key, then parked high in the spectrum."
                  clip={secret}
                  onClip={setSecret}
                  demoUrl={`${import.meta.env.BASE_URL}samples/secret-demo.wav`}
                  demoName="Demo secret — synthesized voice"
                  allowRecord
                  color="blue"
                  warning={secretWarning}
                  onTranscript={(t) => {
                    // the transcript goes in exactly as the recogniser returned it, for the user to review
                    setHiddenText(t)
                    setPayloadMode('text')
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
          {payloadMode === 'voice' && hasText && <p className="mt-4 font-mono text-[11px] text-fg-3">The text box still holds {new TextEncoder().encode(hiddenText).length} bytes; it is not sent in voice mode.</p>}
          {payloadMode === 'text' && secret && <p className="mt-4 font-mono text-[11px] text-fg-3">A voice recording is still loaded; it is not sent in text mode.</p>}
        </div>
      </div>

      <section data-tour-target="secret-key" aria-labelledby="key-title" className="mt-14 grid gap-8 border-t border-line pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Eyebrow index="C" tone="teal">
            Shared secret
          </Eyebrow>
          <h2 id="key-title" className="mt-2 text-[19px] font-normal text-fg">
            Key
          </h2>
          <div className="mt-5">
            <KeyField
              id="key"
              label="Sender key"
              value={key}
              onChange={setKey}
              placeholder="type or generate a passphrase"
              invalid={key.length > 0 && blocked('key-')}
              describedBy="key-help"
              trailing={
                <Button variant="secondary" onClick={() => setKey(randomKey())} icon={<Dices className="size-4" aria-hidden="true" />}>
                  Generate
                </Button>
              }
            />
            <p id="key-help" className={cn('mt-2 text-[12px] leading-relaxed', key.length > 0 && blocked('key-') ? 'text-err' : keyIssue && key.length > 0 ? 'text-warn' : 'text-fg-3')}>
              {key.length > 0 && keyIssue ? keyIssue.detail : 'Required. Share it with the receiver through a separate channel — it is never stored in the audio file.'}
            </p>
          </div>
        </div>
        <dl className="grid content-start gap-0 text-[13px]">
          {[
            ['Voice', `seeds the shuffle of ${NUM_SUBBANDS} sub-bands (16! ≈ 2×10¹³ orders)`],
            ['Text', 'PBKDF2-SHA256 → AES-256-GCM key; seeds the ±1 spreading chips'],
            ['Receiver', 'must type the same key, character for character'],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[5.5rem_1fr] gap-3 border-b border-line py-2.5 last:border-b-0">
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-3">{k}</dt>
              <dd className="text-fg-2">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <BeginnerTour open={tourOpen} steps={TOUR} onClose={() => setTourOpen(false)} />
    </StageFrame>
  )
}
