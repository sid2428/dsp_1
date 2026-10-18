import { motion } from 'motion/react'
import { useElementWidth } from '../charts/use-element-width'

const shade = (i: number, count: number) => `hsl(${178 + (i / (count - 1)) * 34} 70% ${42 + (i / (count - 1)) * 26}%)`

/** Where each speech sub-band ends up after the keyed shuffle — drawn from the actual permutation. */
export function PermutationView({ permutation, caption }: { permutation: number[]; caption?: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(700)
  const count = permutation.length
  const w = Math.max(320, width)
  const cell = w / count
  const yTop = 18
  const yBot = 112
  const h = 22

  return (
    <div ref={ref} className="w-full">
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-fg-3">
        <span>before · low → high frequency</span>
        {caption && <span className="normal-case tracking-normal">{caption}</span>}
      </div>
      <svg width={w} height={yBot + h + 20} role="img" aria-label={`Sub-band permutation: ${permutation.join(', ')}`}>
        {Array.from({ length: count }, (_, i) => (
          <g key={`t${i}`}>
            <rect x={i * cell + 1} y={yTop} width={cell - 2} height={h} fill={shade(i, count)} />
            <text x={i * cell + cell / 2} y={yTop + 15} textAnchor="middle" className="font-mono text-[10px]" fill="#04111b">
              {i}
            </text>
          </g>
        ))}
        {permutation.map((src, dst) => (
          <motion.path
            key={`l${dst}`}
            d={`M ${src * cell + cell / 2} ${yTop + h} C ${src * cell + cell / 2} ${(yTop + yBot) / 2 + 8}, ${dst * cell + cell / 2} ${(yTop + yBot) / 2 - 8}, ${dst * cell + cell / 2} ${yBot}`}
            stroke={shade(src, count)}
            strokeWidth={1.2}
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.85 }}
            transition={{ duration: 0.6, delay: dst * 0.03, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
        {permutation.map((src, dst) => (
          <g key={`b${dst}`}>
            <rect x={dst * cell + 1} y={yBot} width={cell - 2} height={h} fill={shade(src, count)} />
            <text x={dst * cell + cell / 2} y={yBot + 15} textAnchor="middle" className="font-mono text-[10px]" fill="#04111b">
              {src}
            </text>
          </g>
        ))}
        <text x={0} y={yBot + h + 15} className="fill-fg-3 font-mono text-[10px] uppercase">
          after the keyed permutation
        </text>
      </svg>
    </div>
  )
}
