import { useEffect, useRef, useState } from 'react'
import { allow } from '../motion'
import { api, type ClassEvent } from '../api'
import { shortAddr } from '../format'
import { useLive } from '../live'

/** Projector: what's happening in the class, newest first, sliding in as it happens. */
export function EventFeed({ names }: { names: Record<string, string> }) {
  const live = useLive()
  const [initial, setInitial] = useState<ClassEvent[]>([])
  const animated = useRef(new Map<string, boolean>())
  useEffect(() => { api.events().then(setInitial).catch(() => {}) }, [])
  const seen = new Set(live.events.map((e) => `${e.kind}:${e.height}:${e.at}`))
  const all = [...live.events, ...initial.filter((e) => !seen.has(`${e.kind}:${e.height}:${e.at}`))].slice(0, 14)
  const animatedFor = (k: string) => {
    if (!animated.current.has(k)) animated.current.set(k, animated.current.size > 0 && allow('feed', 2500))
    return animated.current.get(k)
  }
  return (
    <section className="card">
      <h2>Live</h2>
      <div className="feed">
        {all.map((e) => (
          <div key={`${e.kind}:${e.height}:${e.at}`} className={`feed-item ${e.kind} ${animatedFor(`${e.kind}:${e.height}:${e.at}`) ? 'enter' : ''}`}>
            <span className="feed-kind" />
            <span>{e.kind === 'block' && e.who ? `${names[e.who] ?? shortAddr(e.who)} made block ${e.height}` : e.text}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
