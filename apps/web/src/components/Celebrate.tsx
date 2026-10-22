import { useNotify } from '../notify'

/** A short burst when you make a block: particles fly out from the middle, then it fades. */
export function Celebrate() {
  const { celebrate } = useNotify()
  if (!celebrate) return null
  const bits = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2
    const dist = 110 + (i % 4) * 38
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, c: i % 3 }
  })
  return (
    <div className="celebrate" key={celebrate.key} aria-hidden="true">
      {bits.map((b, i) => (
        <span key={i} className={`bit c${b.c}`} style={{ ['--x' as string]: `${b.x}px`, ['--y' as string]: `${b.y}px` }} />
      ))}
      <div className="celebrate-card">
        <span>Block</span>
        <b>{celebrate.height}</b>
        <span>is yours</span>
      </div>
    </div>
  )
}
