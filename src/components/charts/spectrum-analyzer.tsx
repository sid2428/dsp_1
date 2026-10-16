import { useMemo, useState } from 'react'
import { welchPsd } from '../../dsp/analysis'
import { computeLaneLayout } from '../../dsp/bit-lane'
import { SAMPLE_RATE } from '../../dsp/constants'
import type { BandLayout } from '../../dsp/spectral-ops'
import { Segmented } from '../ui/primitives'
import { LineChart, type ChartBand } from './line-chart'

const NFFT = 4096
const OVERLAP = 0.5
const MAX_FRAMES = 320

type Zoom = 'full' | 'speech' | 'hidden'
const ZOOM: Record<Zoom, { domain: [number, number]; ticks: number; fmt: (v: number) => string }> = {
  full: { domain: [0, SAMPLE_RATE / 2], ticks: 11, fmt: (v) => (v / 1000).toFixed(0) },
  speech: { domain: [0, 4500], ticks: 9, fmt: (v) => (v / 1000).toFixed(1) },
  hidden: { domain: [15500, SAMPLE_RATE / 2], ticks: 7, fmt: (v) => (v / 1000).toFixed(1) },
}

/** The three bands the system uses, located on the actual FFT grid of this clip. */
export function bandsFor(layout: BandLayout): ChartBand[] {
  const lo = layout.baseLow * layout.binHz
  const hi = (layout.baseLow + layout.width) * layout.binHz
  const clo = layout.carrierLow * layout.binHz
  const lane = computeLaneLayout(layout.n, layout.sampleRate)
  return [
    { from: lo, to: hi, color: '#e7f0f6', label: 'speech band' },
    { from: clo, to: clo + (hi - lo), color: '#4ea5ff', label: 'voice carrier' },
    { from: lane.start * lane.binHz, to: (lane.start + lane.width) * lane.binHz, color: '#20d6c7', label: 'text lane' },
  ]
}

interface SpectrumAnalyzerProps {
  output: Float32Array
  input?: Float32Array | null
  layout: BandLayout
  outputLabel?: string
  inputLabel?: string
  height?: number
  initialZoom?: Zoom
}

/**
 * Calibrated Welch PSD (dB re FS²/Hz, Hann, 4096 points, 50 % overlap) of the real samples at one point
 * of the chain, optionally against the signal that entered that block. Hover for exact values.
 */
export function SpectrumAnalyzer({ output, input, layout, outputLabel = 'output', inputLabel = 'input', height = 360, initialZoom = 'full' }: SpectrumAnalyzerProps) {
  const [zoom, setZoom] = useState<Zoom>(initialZoom)
  const out = useMemo(() => welchPsd(output, SAMPLE_RATE, NFFT, OVERLAP, MAX_FRAMES, 'density'), [output])
  const inp = useMemo(() => (input ? welchPsd(input, SAMPLE_RATE, NFFT, OVERLAP, MAX_FRAMES, 'density') : null), [input])
  const z = ZOOM[zoom]
  const series = useMemo(
    () => [
      ...(inp ? [{ x: inp.freqs, y: inp.db, color: '#7d97ab', label: inputLabel, dashed: true }] : []),
      { x: out.freqs, y: out.db, color: '#20d6c7', label: outputLabel },
    ],
    [inp, out, inputLabel, outputLabel],
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[11px] text-fg-3">
          Welch PSD · {NFFT}-pt Hann · {OVERLAP * 100}% overlap · Δf {(SAMPLE_RATE / NFFT).toFixed(2)} Hz
        </div>
        <Segmented<Zoom>
          label="Frequency range"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: 'full', label: '0–22 kHz' },
            { value: 'speech', label: 'Speech' },
            { value: 'hidden', label: 'Hidden bands' },
          ]}
        />
      </div>
      <LineChart
        series={series}
        bands={bandsFor(layout)}
        xDomain={z.domain}
        xFormat={z.fmt}
        xTicks={z.ticks}
        height={height}
        yRange={120}
        yTicks={7}
        yLabel="dB re FS²/Hz"
        yUnit="dB/Hz"
        fill
        strokeWidth={1.5}
        ariaLabel={`Power spectral density of ${outputLabel}${inp ? ` compared with ${inputLabel}` : ''}`}
      />
    </div>
  )
}
