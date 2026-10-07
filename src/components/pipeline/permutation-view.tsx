import { motion } from 'motion/react'
import { useElementWidth } from '../charts/use-element-width'

const hue = (i: number, count: number) => `hsl(${190 + (i / count) * 140} 85% 60%)`

/** Shows where each speech sub-band ends up after the keyed shuffle. */
export function PermutationView({ permutation, keyLabel }: { permutation: number[]; keyLabel: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(700)
  const count = permutation.length
  const cell = (width - 20) / count
  const yTop = 22
  const yBot = 120
  const h = 26

  return (
    <div ref={ref} className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
      <div className="mb-1 flex justify-between text-[11px] text-slate-400">
        <span>Sub-bands before (low → high frequency)</span>
        <span className="font-mono text-amber-300">key = “{keyLabel}”</span>
      </div>
      <svg width={width - 24} height={yBot + h + 22}>
        {Array.from({ length: count }, (_, i) => (
          <g key={`t${i}`}>
            <rect x={i * cell + 1} y={yTop} width={cell - 2} height={h} rx={4} fill={hue(i, count)} opacity={0.85} />
            <text x={i * cell + cell / 2} y={yTop + 17} textAnchor="middle" className="fill-black font-mono text-[10px] font-bold">
              {i}
            </text>
          </g>
        ))}
        {permutation.map((src, dst) => (
          <motion.path
            key={`l${dst}`}
            d={`M ${src * cell + cell / 2} ${yTop + h} C ${src * cell + cell / 2} ${(yTop + yBot) / 2 + 10}, ${dst * cell + cell / 2} ${(yTop + yBot) / 2 - 10}, ${dst * cell + cell / 2} ${yBot}`}
            stroke={hue(src, count)}
            strokeWidth={1.5}
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.8 }}
            transition={{ duration: 0.8, delay: dst * 0.04 }}
          />
        ))}
        {permutation.map((src, dst) => (
          <g key={`b${dst}`}>
            <rect x={dst * cell + 1} y={yBot} width={cell - 2} height={h} rx={4} fill={hue(src, count)} opacity={0.85} />
            <text x={dst * cell + cell / 2} y={yBot + 17} textAnchor="middle" className="fill-black font-mono text-[10px] font-bold">
              {src}
            </text>
          </g>
        ))}
        <text x={0} y={yBot + h + 16} className="fill-slate-400 text-[11px]">
          Sub-bands after the keyed permutation
        </text>
      </svg>
    </div>
  )
}
