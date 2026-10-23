import { useEffect, useRef, useState } from 'react'

import { allow } from '../motion'

/** Animates a number from its previous value to the new one, so changes are noticeable. */
export function useCountUp(target: number, ms = 700): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (from.current === target || !allow('countup', 1500)) {
      from.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(a + (target - a) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}
