import { Mic, Sparkles, Square, Upload } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { loadClipFromFile, loadClipFromUrl, MicRecorder, type AudioClip } from '../../audio/load-audio'
import { MAX_DURATION_S } from '../../dsp/constants'
import { Badge, Button, Card, CardTitle } from '../ui/primitives'
import { WaveformPlayer } from './waveform-player'

interface AudioSourceCardProps {
  title: string
  hint: string
  icon: ReactNode
  clip: AudioClip | null
  onClip: (clip: AudioClip) => void
  onError: (msg: string) => void
  demoUrl: string
  demoName: string
  allowRecord?: boolean
  color: 'cyan' | 'violet'
  warning?: string | null
}

export function AudioSourceCard({ title, hint, icon, clip, onClip, onError, demoUrl, demoName, allowRecord, color, warning }: AudioSourceCardProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MicRecorder | null>(null)
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)

  const guard = async (fn: () => Promise<AudioClip>) => {
    setLoading(true)
    try {
      onClip(await fn())
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const toggleRecord = async () => {
    if (recording) {
      setRecording(false)
      const rec = recorderRef.current
      recorderRef.current = null
      if (rec) await guard(() => rec.stop())
      return
    }
    const rec = new MicRecorder()
    try {
      await rec.start()
      recorderRef.current = rec
      setRecording(true)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card className="flex flex-col">
      <CardTitle icon={icon} title={title} hint={hint} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()} disabled={loading || recording}>
          Upload audio
        </Button>
        {allowRecord && (
          <Button
            variant={recording ? 'danger' : 'secondary'}
            size="sm"
            icon={recording ? <Square className="size-3.5" /> : <Mic className="size-3.5" />}
            onClick={toggleRecord}
            disabled={loading}
          >
            {recording ? 'Stop recording' : 'Record voice'}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon={<Sparkles className="size-3.5" />}
          onClick={() => guard(() => loadClipFromUrl(demoUrl, demoName))}
          loading={loading}
          disabled={recording}
        >
          Use demo clip
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void guard(() => loadClipFromFile(f))
          }}
        />
      </div>

      <div className="mt-4 grow">
        {recording ? (
          <div className="flex h-[104px] items-center justify-center gap-3 rounded-xl bg-rose-500/10 text-sm text-rose-200 ring-1 ring-rose-400/30">
            <span className="size-3 animate-pulse rounded-full bg-rose-400" /> Recording… speak your secret message
          </div>
        ) : clip ? (
          <div className="space-y-2">
            <WaveformPlayer samples={clip.samples} label={clip.name} color={color} normalize />
            <div className="flex flex-wrap gap-2">
              <Badge>{clip.duration.toFixed(2)} s</Badge>
              <Badge>44.1 kHz mono</Badge>
              <Badge>{clip.samples.length.toLocaleString('en-US')} samples</Badge>
              {clip.truncated && <Badge className="text-amber-300">trimmed to {MAX_DURATION_S} s</Badge>}
            </div>
          </div>
        ) : (
          <div className="flex h-[104px] items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-slate-500">
            No audio loaded yet
          </div>
        )}
        {warning && <p className="mt-2 text-xs text-amber-300">{warning}</p>}
      </div>
    </Card>
  )
}
