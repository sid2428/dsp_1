import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import type { BandLayout } from '../../dsp/spectral-ops'
import type { PipelineNode } from '../../pipeline/stage-meta'
import type { StageView } from '../../worker/protocol'
import { WaveformPlayer } from '../audio/waveform-player'
import { LineChart, type ChartBand } from '../charts/line-chart'
import { SpectrogramCanvas } from '../charts/spectrogram-canvas'
import { Badge, Card } from '../ui/primitives'

export function bandsFor(layout: BandLayout): ChartBand[] {
  const lo = layout.baseLow * layout.binHz
  const hi = (layout.baseLow + layout.width) * layout.binHz
  const clo = layout.carrierLow * layout.binHz
  return [
    { from: lo, to: hi, color: '#a78bfa', label: 'speech band' },
    { from: clo, to: clo + (hi - lo), color: '#22d3ee', label: 'carrier band' },
  ]
}

export function marksFor(layout: BandLayout) {
  const clo = layout.carrierLow * layout.binHz
  return [
    { hz: clo, label: `${(clo / 1000).toFixed(1)} kHz`, color: '#22d3ee' },
    { hz: clo + layout.width * layout.binHz, label: '', color: '#22d3ee' },
  ]
}

interface StageInspectorProps<S extends string> {
  node: PipelineNode<S>
  views: Record<S, StageView>
  layout: BandLayout
  extra?: ReactNode
}

export function StageInspector<S extends string>({ node, views, layout, extra }: StageInspectorProps<S>) {
  if (!node.stage) {
    return (
      <motion.div key={node.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <Card className="space-y-5">
          <InspectorHeader node={node} />
          {extra}
        </Card>
      </motion.div>
    )
  }
  const view = views[node.stage]
  const before = node.before ? views[node.before] : null
  const beforeNode = node.before
  const series = [
    ...(before && beforeNode
      ? [{ x: before.psd.freqs, y: before.psd.db, color: '#64748b', label: "input of this block", dashed: true }]
      : []),
    { x: view.psd.freqs, y: view.psd.db, color: '#22d3ee', label: "output of this block" },
  ]

  return (
    <motion.div key={node.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className="space-y-5">
        <InspectorHeader node={node} />

        <WaveformPlayer
          samples={view.samples}
          normalize={node.normalize}
          label={node.normalize ? 'Listen to this stage (loudness normalised)' : 'Listen to this stage'}
          color={node.kind === 'output' ? 'emerald' : node.kind === 'fft' ? 'violet' : 'cyan'}
        />

        {extra}

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium text-slate-300">Power spectrum (Welch PSD)</div>
            <LineChart series={series} bands={bandsFor(layout)} xDomain={[0, 22050]} />
          </div>
          <SpectrogramCanvas spec={view.spec} title="Spectrogram" marks={marksFor(layout)} height={200} />
        </div>
      </Card>
    </motion.div>
  )
}

function InspectorHeader<S extends string>({ node }: { node: PipelineNode<S> }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">{node.title}</h3>
          <Badge>{node.subtitle}</Badge>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{node.theory}</p>
      </div>
      {node.formula && (
        <div className="rounded-xl bg-violet-500/10 px-4 py-3 font-mono text-sm text-violet-200 ring-1 ring-violet-400/30">{node.formula}</div>
      )}
    </div>
  )
}
