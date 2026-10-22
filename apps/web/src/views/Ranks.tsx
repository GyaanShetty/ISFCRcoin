import { useEffect, useState } from 'react'
import { api } from '../api'
import { Big } from '../components/Big'
import { coins, initials, shortAddr } from '../format'
import { useLive } from '../live'
import { useWallet } from '../wallet'
import { Tip } from '../components/Tip'

type Row = { address: string; blocks: number; rewards: string }

export function Ranks() {
  const live = useLive()
  const { key, name } = useWallet()
  const [rows, setRows] = useState<Row[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    api.leaderboard().then(setRows).catch(() => {})
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion])
  const total = rows.reduce((s, r) => s + r.blocks, 0)
  const label = (r: Row) => (r.address === key?.address ? `${name || 'You'} (you)` : names[r.address] ?? shortAddr(r.address))
  const tag = (r: Row) => initials(r.address === key?.address ? name || 'Y' : names[r.address] ?? r.address.slice(6, 8))
  const [first, second, third] = rows

  return (
    <div className="stack">
      <h1>Top miners</h1>
      <Tip id="ranks-watch" point="none">Everyone in the room. Watch how the order changes when the teacher switches the rules.</Tip>
      {rows.length === 0 && <div className="card muted">No blocks yet. Be the first!</div>}
      {first && (
        <div className="podium">
          {[second, first, third].map((r, i) => r ? (
            <div key={r.address} className={`p p${[2, 1, 3][i]}`}>
              <div className="avatar">{tag(r)}</div>
              <Big v={String(r.blocks)} size="md" />
              <div className="n">{label(r)}</div>
            </div>
          ) : <div key={i} />)}
        </div>
      )}
      {rows.length > 0 && (
        <section className="card">
          <div className="list">
            {rows.map((r, i) => (
              <div key={r.address} className={`item ${r.address === key?.address ? 'hl' : ''}`}>
                <div className="main"><div className="t">{i + 1}. {label(r)}</div><div className="s">{coins(r.rewards)} ISFCR earned</div></div>
                <div className="meter"><span style={{ width: `${(100 * r.blocks) / Math.max(1, total)}%` }} /></div>
                <span className="fee">{r.blocks}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
