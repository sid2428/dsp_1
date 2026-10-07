import { ArrowRight, Send, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WaveformPlayer } from '../components/audio/waveform-player'
import { TransmissionAnimation } from '../components/channel/transmission-animation'
import { Button, Card, CardTitle, fmtDb, Metric, Slider, Switch } from '../components/ui/primitives'
import { useStegoStore } from '../store/use-stego-store'

const MIN_ANIMATION_MS = 2200

export function ChannelStep() {
  const { channel, setChannel, transmit, transmitted, busy, goTo } = useStegoStore()
  const [animating, setAnimating] = useState(false)
  const noisy = channel.noiseSnrDb !== null

  useEffect(() => {
    if (!animating) return
    const t = setTimeout(() => setAnimating(false), MIN_ANIMATION_MS)
    return () => clearTimeout(t)
  }, [animating])

  const send = async () => {
    setAnimating(true)
    await transmit()
  }

  const sending = animating || busy === 'channel'
  const delivered = !!transmitted && !sending

  return (
    <div className="space-y-6">
      <TransmissionAnimation active={sending} delivered={delivered} noisy={noisy} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardTitle
            icon={<SlidersHorizontal className="size-4" />}
            title="Channel conditions"
            hint="Simulate what happens to the file on its way. A clean channel = sending the WAV as an attachment."
          />
          <div className="space-y-5">
            <Switch checked={channel.quantize16} onChange={(v) => setChannel({ quantize16: v })} label="Save as 16-bit PCM WAV (quantisation)" />
            <Switch checked={noisy} onChange={(v) => setChannel({ noiseSnrDb: v ? 30 : null })} label="Add white Gaussian noise" />
            <Slider
              label="Noise level (SNR of channel)"
              value={channel.noiseSnrDb ?? 30}
              min={0}
              max={60}
              step={1}
              disabled={!noisy}
              onChange={(v) => setChannel({ noiseSnrDb: v })}
              format={(v) => `${v} dB`}
            />
            <Slider label="Volume change" value={channel.gainDb} min={-20} max={6} step={1} onChange={(v) => setChannel({ gainDb: v })} format={(v) => `${v > 0 ? '+' : ''}${v} dB`} />
            <Button className="w-full" size="lg" onClick={send} loading={sending} icon={<Send className="size-4" />}>
              {transmitted ? 'Transmit again' : 'Transmit stego audio'}
            </Button>
          </div>
        </Card>

        <Card>
          <CardTitle title="At the receiver" hint="The file that arrived. Nobody listening in hears anything but music." />
          {delivered && transmitted ? (
            <div className="space-y-4">
              <WaveformPlayer samples={transmitted.received.samples} color="cyan" label="received.wav" downloadName="received.wav" height={72} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Received vs sent" value={fmtDb(transmitted.channelSnrDb)} unit="dB SNR" hint="Damage done by the channel" />
                <Metric
                  label="Channel"
                  value={noisy ? `AWGN ${channel.noiseSnrDb} dB` : 'clean'}
                  tone="violet"
                  hint={`${channel.quantize16 ? '16-bit PCM' : '32-bit float'} · gain ${channel.gainDb} dB`}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-slate-500">
              {sending ? 'Transmitting…' : 'Press “Transmit” to send the stego file'}
            </div>
          )}
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => goTo(3)} disabled={!delivered} icon={<ArrowRight className="size-5" />}>
          Go to receiver
        </Button>
      </div>
    </div>
  )
}
