import { ChevronLeft, Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { dft, traceFft, type FftKind } from '../../dsp/fft'
import { Badge, Button, Card, CardTitle, Segmented, Slider } from '../ui/primitives'
import { ButterflyDiagram, flatten, fmtComplex } from './butterfly-diagram'

interface ButterflyExplorerProps {
  /** Real part of the signal the full-size FFT actually transformed. */
  re: Float32Array
  /** Imaginary part, when that FFT had a complex input (the encoder's z = voice + j·cover). */
  im?: Float32Array | null
  /** Which FFT this zooms into, e.g. "encoder" or "decoder". */
  role: 'encoder' | 'decoder'
  /** What `re` / `im` are, for the caption. */
  inputLabel: string
  stats: { fftSize: number; fftStages: number; butterflyCount: number; fftMs: number | null; kind: FftKind }
}

function loudestOffset(x: Float32Array, n: number): number {
  let best = 0
  let idx = 0
  for (let i = 0; i < x.length - n; i += 64) {
    const a = Math.abs(x[i])
    if (a > best) {
      best = a
      idx = i
    }
  }
  return idx
}

const fmtInt = (v: number) => v.toLocaleString('en-US')

export function ButterflyExplorer({ re: received, im: receivedIm = null, role, inputLabel, stats }: ButterflyExplorerProps) {
  const [n, setN] = useState<8 | 16>(8)
  const kind = stats.kind
  const [offset, setOffset] = useState(() => loudestOffset(receivedIm ?? received, 16))
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(700)

  const input = useMemo(() => Array.from(received.subarray(offset, offset + n)), [received, offset, n])
  const inputIm = useMemo(() => (receivedIm ? Array.from(receivedIm.subarray(offset, offset + n)) : null), [receivedIm, offset, n])
  const trace = useMemo(() => traceFft(input, kind, inputIm ?? undefined), [input, inputIm, kind])
  const flat = useMemo(() => flatten(trace), [trace])
  const total = flat.length
  const done = cursor >= total

  useEffect(() => {
    setCursor(0)
    setPlaying(false)
  }, [trace])

  useEffect(() => {
    if (!playing) return
    if (cursor >= total) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setCursor((c) => c + 1), speed)
    return () => clearTimeout(t)
  }, [playing, cursor, total, speed])

  const current = cursor < total ? flat[cursor] : null
  const inCol = current ? trace.columns[current.stage] : null
  const outCol = current ? trace.columns[current.stage + 1] : null

  const verifyErr = useMemo(() => {
    const ref = dft(input, inputIm ?? new Array(n).fill(0))
    const last = trace.columns[trace.columns.length - 1]
    let e = 0
    trace.outputOrder.forEach((k, slot) => {
      e = Math.max(e, Math.hypot(last.re[slot] - ref.re[k], last.im[slot] - ref.im[k]))
    })
    return e
  }, [trace, input, inputIm, n])

  const spectrum = useMemo(() => {
    const last = trace.columns[trace.columns.length - 1]
    const mags = new Array<number>(n).fill(0)
    trace.outputOrder.forEach((k, slot) => (mags[k] = Math.hypot(last.re[slot], last.im[slot])))
    return mags
  }, [trace, n])
  const magMax = Math.max(...spectrum, 1e-9)

  const N = stats.fftSize
  const directOps = N * N
  const speedup = directOps / stats.butterflyCount

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h3 className="text-[17px] font-normal text-fg">
              Radix-2 {kind.toUpperCase()} butterflies · {n}-point window
            </h3>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-fg-2">
              {inputLabel}, samples {fmtInt(offset)}–{fmtInt(offset + n - 1)}, run through the same FFT routine the {role} used for its {fmtInt(stats.fftSize)}-point transform.
            </p>
          </div>
          <Segmented
            label="Window size"
            value={String(n) as '8' | '16'}
            onChange={(v) => setN(Number(v) as 8 | 16)}
            options={[
              { value: '8', label: 'N = 8' },
              { value: '16', label: 'N = 16' },
            ]}
          />
        </div>

        <ButterflyDiagram trace={trace} cursor={cursor} onPick={(f) => setCursor(f)} />

        <div className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-[auto_1fr_1fr] md:items-end">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0} icon={<ChevronLeft className="size-4" aria-hidden="true" />} aria-label="Previous butterfly">
              Back
            </Button>
            <Button size="sm" onClick={() => (done ? (setCursor(0), setPlaying(true)) : setPlaying((p) => !p))} icon={playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}>
              {playing ? 'Pause' : done ? 'Replay' : 'Play'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCursor((c) => Math.min(total, c + 1))} disabled={done} icon={<StepForward className="size-4" aria-hidden="true" />}>
              Step
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCursor(total)} disabled={done}>
              Finish
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCursor(0)} icon={<RotateCcw className="size-4" aria-hidden="true" />}>
              Reset
            </Button>
          </div>
          <Slider label="Animation delay" value={speed} min={100} max={1500} step={50} onChange={setSpeed} format={(v) => `${v} ms`} />
          <Slider
            label="Window position"
            value={offset}
            min={0}
            max={Math.max(0, received.length - 16)}
            step={1}
            onChange={setOffset}
            format={(v) => `n = ${fmtInt(v)} (${(v / 44100).toFixed(2)} s)`}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle title="Current butterfly" hint={`${Math.min(cursor, total)} / ${total} butterflies executed`} />
          <AnimatePresence mode="wait">
            {current && inCol && outCol ? (
              <motion.div
                key={current.flat}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="space-y-3 font-mono text-[13px]"
              >
                <div className="flex flex-wrap gap-2">
                  <Badge>stage {current.stage + 1}</Badge>
                  <Badge>
                    wings {current.top} ↔ {current.bottom}
                  </Badge>
                  <Badge className="text-blue">
                    W<sub>{n}</sub>
                    <sup>{current.k}</sup> = {fmtComplex(Math.cos((2 * Math.PI * current.k) / n), -Math.sin((2 * Math.PI * current.k) / n), 3)}
                  </Badge>
                </div>
                <div className="border-l border-line-2 py-2 pl-4 leading-7">
                  <div>
                    a = <span className="text-blue">{fmtComplex(inCol.re[current.top], inCol.im[current.top], 4)}</span>
                  </div>
                  <div>
                    b = <span className="text-blue">{fmtComplex(inCol.re[current.bottom], inCol.im[current.bottom], 4)}</span>
                  </div>
                  <div className="my-2 border-t border-line" />
                  {kind === 'dit' ? (
                    <>
                      <div>
                        a′ = a + W·b = <span className="text-teal">{fmtComplex(outCol.re[current.top], outCol.im[current.top], 4)}</span>
                      </div>
                      <div>
                        b′ = a − W·b = <span className="text-teal">{fmtComplex(outCol.re[current.bottom], outCol.im[current.bottom], 4)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        a′ = a + b = <span className="text-teal">{fmtComplex(outCol.re[current.top], outCol.im[current.top], 4)}</span>
                      </div>
                      <div>
                        b′ = (a − b)·W = <span className="text-teal">{fmtComplex(outCol.re[current.bottom], outCol.im[current.bottom], 4)}</span>
                      </div>
                    </>
                  )}
                </div>
                <p className="font-sans text-xs leading-relaxed text-fg-3">
                  {kind === 'dit'
                    ? 'Decimation in time: the input is split into even/odd samples recursively, so it enters in bit-reversed order. The twiddle multiplies the lower wing before the add/subtract.'
                    : 'Decimation in frequency: the output is split into even/odd frequencies recursively. Inputs enter in natural order, the twiddle multiplies after the subtract, and outputs come out bit-reversed.'}
                </p>
              </motion.div>
            ) : (
              <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                <div className="text-sm text-ok">All {total} butterflies done — this column is the DFT X[k].</div>
                <div className="flex h-28 items-end gap-1.5">
                  {spectrum.map((m, k) => (
                    <div key={k} className="flex flex-1 flex-col items-center gap-1">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(m / magMax) * 88}px` }}
                        className="w-full bg-teal"
                      />
                      <span className="font-mono text-[9px] text-fg-3">{k}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-fg-3">
                  |X[k]| · check against the direct DFT: max error{' '}
                  <span className="font-mono text-ok">{verifyErr.toExponential(1)}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <Card>
          <CardTitle title={`The real ${role} FFT`} hint={role === 'decoder' ? 'Same function, full size — this is what extracted the hidden bands.' : 'Same function, full size — this transformed voice and cover together.'} />
          <div className="grid grid-cols-2 gap-3 font-mono">
            <Stat label="N (zero-padded)" value={`2^${stats.fftStages} = ${fmtInt(N)}`} />
            <Stat label="algorithm" value={`radix-2 ${stats.kind.toUpperCase()}`} />
            <Stat label="stages × butterflies" value={`${stats.fftStages} × ${fmtInt(N / 2)}`} />
            <Stat label="total butterflies" value={fmtInt(stats.butterflyCount)} />
            <Stat label="time in browser" value={stats.fftMs === null ? 'see process log' : `${stats.fftMs.toFixed(1)} ms`} />
            <Stat label="vs direct DFT (N²)" value={`${speedup.toFixed(0)}× fewer ops`} />
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] text-fg-3">Butterfly span per stage (distance between the two wings)</div>
            <div className="space-y-[3px]">
              {Array.from({ length: stats.fftStages }, (_, s) => {
                const span = stats.kind === 'dit' ? 2 ** s : N / 2 ** (s + 1)
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className="w-6 text-right font-mono text-[9px] text-fg-3">{s + 1}</span>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${((Math.log2(span) + 1) / stats.fftStages) * 100}%` }}
                      transition={{ delay: s * 0.03 }}
                      className="h-1.5 bg-blue"
                    />
                    <span className="font-mono text-[9px] text-fg-3">{fmtInt(span)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line py-2">
      <div className="font-sans text-[10px] uppercase tracking-wider text-fg-3">{label}</div>
      <div className="mt-0.5 text-sm text-fg">{value}</div>
    </div>
  )
}
