import { useSyncExternalStore, type ReactNode } from 'react'

// Beginner tips: hand-written notes with a dotted arrow pointing at what to do next.
// Each can be dismissed; dismissals are remembered per browser (and can be reset).
const KEY = 'isfcr.tips.hidden.v1'

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

let hidden = load()
const listeners = new Set<() => void>()
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...hidden]))
  } catch {
    // storage unavailable: tips just reappear next visit
  }
  listeners.forEach((l) => l())
}

export const tips = {
  hide(id: string) {
    hidden = new Set(hidden).add(id)
    save()
  },
  showAll() {
    hidden = new Set()
    save()
  },
  anyHidden: () => hidden.size > 0,
}

function useHidden(): Set<string> {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => hidden)
}

/**
 * A hand-drawn note. `point` says where the dotted arrow aims: at the element
 * just below the note ('down'), or just above it ('up').
 */
export function Tip({ id, children, point = 'down' }: { id: string; children: ReactNode; point?: 'down' | 'up' | 'none' }) {
  const h = useHidden()
  if (h.has(id)) return null
  const arrow = (
    <svg className={`tip-arrow ${point}`} viewBox="0 0 80 44" aria-hidden="true">
      <path d="M8 4 C 30 6, 52 14, 60 36" />
      <path d="M50 30 L 60 38 L 66 26" />
    </svg>
  )
  return (
    <div className={`tip ${point}`} role="note">
      {point === 'up' && arrow}
      <div className="tip-note">
        <p>{children}</p>
        <button className="tip-ok" onClick={() => tips.hide(id)}>got it</button>
      </div>
      {point === 'down' && arrow}
    </div>
  )
}

/** "Show the beginner tips again" link, for anyone who dismissed them too quickly. */
export function ShowTipsAgain() {
  useHidden()
  if (!tips.anyHidden()) return null
  return <button className="tip-reset" onClick={() => tips.showAll()}>Show the beginner tips again</button>
}
