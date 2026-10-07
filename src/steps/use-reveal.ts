import { useEffect, useState } from 'react'

/** Counts from -1 up to `max` one tick at a time whenever `trigger` or `epoch` changes (pipeline light-up). */
export function useReveal(max: number, trigger: unknown, epoch = 0, intervalMs = 380): number {
  const [revealed, setRevealed] = useState(-1)
  useEffect(() => {
    if (trigger == null) {
      setRevealed(-1)
      return
    }
    setRevealed(-1)
    let v = -1
    const id = setInterval(() => {
      v += 1
      setRevealed(v)
      if (v >= max) clearInterval(id)
    }, intervalMs)
    return () => clearInterval(id)
  }, [max, trigger, epoch, intervalMs])
  return revealed
}
