import { Ear, Lock, MessageSquareLock, RotateCcw, ShieldAlert, Volume2 } from 'lucide-react'
import { motion } from 'motion/react'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { SpectrogramCanvas, specMax } from '../components/charts/spectrogram-canvas'
import { marksFor } from '../components/pipeline/stage-inspector'
import { TextDecodePanel, TextStatusBanner } from '../components/text-lane/text-result'
import { Button, Card, CardTitle, fmtDb, Metric } from '../components/ui/primitives'
import { useStegoStore } from '../store/use-stego-store'

export function OutputStep() {
  const { encoded, decoded, transmitted, receivedFile, goTo } = useStegoStore()
  if (!decoded) return null
  const stego = receivedFile?.samples ?? transmitted?.received.samples ?? decoded.stages.received.samples
  const m = decoded.metrics
  const wk = decoded.wrongKey
  const coverMax = encoded ? Math.max(specMax(encoded.stages.cover.spec), specMax(encoded.stages.stego.spec)) : undefined
  const secretMax = encoded ? specMax(encoded.stages['secret-bandlimited'].spec) : undefined

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="h-full ring-1 ring-cyan-400/30">
            <CardTitle icon={<Ear className="size-4" />} title="What everyone hears" hint="Normal audio — the hidden message should not be audible." />
            <WaveformPlayer samples={stego} color="cyan" label="received stego audio" height={88} downloadName="stego-received.wav" />
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="h-full ring-1 ring-emerald-400/40">
            <CardTitle icon={<Volume2 className="size-4" />} title="What the receiver hears" hint="Recovered secret voice, reconstructed with the correct key." />
            <WaveformPlayer samples={decoded.stages.recovered.samples} color="emerald" label="recovered secret" height={88} downloadName="recovered-secret.wav" normalize />
          </Card>
        </motion.div>
      </div>

      {(decoded.text.status !== 'no-payload' || encoded?.text) && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="ring-1 ring-violet-400/40">
            <CardTitle
              icon={<MessageSquareLock className="size-4" />}
              title="Recovered secret text"
              hint="Read from the 20.1–21.9 kHz lane of the same FFT: despread, BPSK decision, AES-GCM decryption."
            />
            <TextDecodePanel info={decoded.text} sent={encoded?.text ?? null} />
          </Card>
        </motion.div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {encoded && <Metric label="Cover vs stego SNR" value={fmtDb(encoded.metrics.coverSnrDb)} unit="dB" hint="Imperceptibility of the hiding" />}
        {m && <Metric label="Recovered SNR" value={fmtDb(m.snrDb)} unit="dB" tone="emerald" hint="vs. band-limited original (gain matched)" />}
        {m && <Metric label="Segmental SNR" value={fmtDb(m.segSnrDb)} unit="dB" tone="emerald" hint="Frame-averaged, tracks speech quality" />}
        {m && <Metric label="Correlation" value={m.correlation.toFixed(3)} tone="violet" hint="1.000 = identical waveform" />}
        <Metric label="Decode FFT" value={decoded.fftMs.toFixed(1)} unit="ms" tone="amber" hint={`${decoded.butterflyCount.toLocaleString('en-US')} butterflies`} />
      </div>
      {!m && (
        <p className="text-xs text-slate-400">
          Quality metrics need the original secret, so they are only shown when this session also did the encoding.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle title="Technical results" hint="Compare the original and recovered signals, spectra and metrics below." />
          {encoded && <WaveformPlayer samples={encoded.stages['secret-bandlimited'].samples} color="violet" label="original secret (300–3400 Hz)" normalize compact />}
          <div className="mt-3">
            <WaveformPlayer
              samples={decoded.stages.deinverted.samples}
              color="amber"
              label="before the final time reversal — the message played backwards"
              normalize
              compact
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {encoded && <SpectrogramCanvas spec={encoded.stages['secret-bandlimited'].spec} title="Original" dbMax={secretMax} height={150} />}
            <SpectrogramCanvas spec={decoded.stages.recovered.spec} title="Recovered" height={150} />
          </div>
        </Card>

        <Card>
          <CardTitle title="Cover vs stego spectrogram" hint="Same colour scale. The secret lives in the dashed carrier band." />
          <div className="grid grid-cols-2 gap-3">
            {encoded && <SpectrogramCanvas spec={encoded.stages.cover.spec} title="Original cover" dbMax={coverMax} height={330} />}
            <SpectrogramCanvas spec={decoded.stages.received.spec} title="Received stego" dbMax={coverMax} height={330} marks={marksFor(decoded.layout)} />
          </div>
        </Card>
      </div>

      <Card className="ring-1 ring-rose-400/30">
        <CardTitle
          icon={<ShieldAlert className="size-4 text-rose-300" />}
          title="What happens with the wrong key?"
          hint={`Decoded the same audio with key “${wk.key}” (one character added).`}
        />
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <WaveformPlayer samples={wk.recovered.samples} color="rose" label="output with the wrong key" normalize />
            {wk.metrics && (
              <div className="grid grid-cols-3 gap-3">
                <Metric label="SNR" value={fmtDb(wk.metrics.snrDb)} unit="dB" tone="rose" />
                <Metric label="Seg. SNR" value={fmtDb(wk.metrics.segSnrDb)} unit="dB" tone="rose" />
                <Metric label="Correlation" value={wk.metrics.correlation.toFixed(3)} tone="rose" />
              </div>
            )}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              The FFT, band-pass, inversion and time reversal are all undone correctly; only the 16 sub-bands stay in the wrong order. That alone is enough
              to make the speech unintelligible.
            </p>
          </div>
          <div className="space-y-3">
            <SpectrogramCanvas spec={wk.recovered.spec} title="Wrong-key output" height={180} />
            {wk.text && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-300">Hidden text with the wrong key</div>
                <TextStatusBanner info={wk.text} />
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => goTo(3)}>
          Back to receiver
        </Button>
        <Button variant="secondary" onClick={() => goTo(0)} icon={<RotateCcw className="size-4" />}>
          Try other audio
        </Button>
      </div>
    </div>
  )
}
