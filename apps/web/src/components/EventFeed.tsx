import { useEffect, useState } from 'react'
import { api, type ClassEvent } from '../api'
import { shortAddr } from '../format'
import { useLive } from '../live'

/** Projector: what's happening in the class, newest first, sliding in as it happens. */
export function EventFeed({ names }: { names: Record<string, string> }) {
  const live = useLive()
  const [initial, setInitial] = useState<ClassEvent[]>([])
  useEffect(() => { api.events().then(setInitial).catch(() => {}) }, [])
  const seen = new Set(live.events.map((e) => `${e.kind}:${e.height}:${e.at}`))
  const all = [...live.events, ...initial.filter((e) => !seen.has(`${e.kind}:${e.height}:${e.at}`))].slice(0, 14)
  return (
    <section className="card">
      <h2>Live</h2>
      <div className="feed">
        {all.map((e) => (
          <div key={`${e.kind}:${e.height}:${e.at}`} className={`feed-item ${e.kind}`}>
            <span className="feed-kind" />
            <span>{e.kind === 'block' && e.who ? `${names[e.who] ?? shortAddr(e.who)} made block ${e.height}` : e.text}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
