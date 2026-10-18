import { useMemo } from 'react'
import type { AudioClip } from '../../audio/load-audio'
import { welchPsd } from '../../dsp/analysis'
import { computeLaneLayout } from '../../dsp/bit-lane'
import { SAMPLE_RATE } from '../../dsp/constants'
import { computeLayout } from '../../dsp/spectral-ops'
import { fftSizeFor } from '../../dsp/stego'
import { LineChart } from '../charts/line-chart'

/**
 * The cover's measured spectrum with the two bands the encoder will overwrite. The energy share is
 * integrated from the same PSD, so the user sees how much of the cover is about to be removed.
 */
export function CoverSpectrum({ cover }: { cover: AudioClip }) {
  const data = useMemo(() => {
    const psd = welchPsd(cover.samples, SAMPLE_RATE, 2048, 0.5, 160, 'density')
    const n = fftSizeFor(cover.samples.length)
    let bands: { voice: [number, number]; text: [number, number] } | null = null
    try {
      const v = computeLayout(n, SAMPLE_RATE)
      const l = computeLaneLayout(n, SAMPLE_RATE)
      bands = { voice: [v.carrierLow * v.binHz, (v.carrierLow + v.width) * v.binHz], text: [l.start * l.binHz, (l.start + l.width) * l.binHz] }
    } catch {
      bands = null
    }
    let total = 0
    let inBands = 0
    for (let k = 0; k < psd.freqs.length; k++) {
      const p = 10 ** (psd.db[k] / 10)
      total += p
      const f = psd.freqs[k]
      if (bands && ((f >= bands.voice[0] && f < bands.voice[1]) || (f >= bands.text[0] && f < bands.text[1]))) inBands += p
    }
    return { psd, bands, share: total > 0 ? inBands / total : 0 }
  }, [cover])

  const pct = data.share * 100
  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-3">Cover spectrum · where the message will live</span>
        {data.bands && (
          <span className="font-mono text-[11px] text-fg-2">
            {pct < 0.01 ? '<0.01' : pct.toFixed(pct < 1 ? 2 : 1)}% of the cover’s energy is replaced
          </span>
        )}
      </div>
      <LineChart
        series={[{ x: data.psd.freqs, y: data.psd.db, color: '#a9bfce', label: 'cover PSD' }]}
        bands={
          data.bands
            ? [
                { from: data.bands.voice[0], to: data.bands.voice[1], color: '#4ea5ff', label: 'voice' },
                { from: data.bands.text[0], to: data.bands.text[1], color: '#20d6c7', label: 'text' },
              ]
            : []
        }
        xDomain={[0, SAMPLE_RATE / 2]}
        yRange={100}
        height={150}
        xTicks={6}
        yTicks={3}
        yLabel="dB/Hz"
        yUnit="dB/Hz"
        fill
        ariaLabel="Power spectral density of the cover audio, with the voice and text bands highlighted"
      />
    </div>
  )
}
