/** Oversized numeral with a small unit, e.g. <Big v="64" sup="%" />. */
export function Big({ v, sup, small, size }: { v: string; sup?: string; small?: string; size?: 'xl' | 'md' | 'name' }) {
  return (
    <div className={`big ${size ?? ''}`}>
      {v}
      {sup && <sup>{sup}</sup>}
      {small && <small>{small}</small>}
    </div>
  )
}
