import { useEffect, useState } from 'react'
import type { BlockSummary, Info } from '../api'
import { modeName, short } from '../format'

export const PEER_KEY = 'isfcr.peer.v1'
export const readPeer = () => { try { return localStorage.getItem(PEER_KEY) ?? '' } catch { return '' } }
export const writePeer = (u: string) => { try { u ? localStorage.setItem(PEER_KEY, u) : localStorage.removeItem(PEER_KEY) } catch { /* ignore */ } }

interface Side { info: Info; chain: BlockSummary[] }

async function load(base: string): Promise<Side> {
  const get = async (p: string) => {
    const r = await fetch(base + p)
    if (!r.ok) throw new Error(`${base}: HTTP ${r.status}`)
    return r.json()
  }
  const [info, chain] = await Promise.all([get('/api/info'), get('/api/chain?limit=14')])
  return { info, chain }
}

/**
 * Hard-fork demo: this node and a second node side by side. Blocks both chains
 * share are dimmed; from the first height where hashes differ, each side is
 * colored, which is the moment the old-rules node split off.
 */
export function ForkView({ peer }: { peer: string }) {
  const [a, setA] = useState<Side | null>(null)
  const [b, setB] = useState<Side | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const tick = async () => {
      try {
        const [x, y] = await Promise.all([load(''), load(peer.replace(/\/$/, ''))])
        setA(x)
        setB(y)
        setErr('')
      } catch (e) {
        setErr((e as Error).message)
      }
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => clearInterval(t)
  }, [peer])

  if (err) return <section className="card"><h2>Fork watch</h2><p className="error">{err}</p></section>
  if (!a || !b) return null

  const byHeightB = new Map(b.chain.map((x) => [x.height, x]))
  const top = Math.max(a.info.height, b.info.height)
  const heights = Array.from({ length: 12 }, (_, i) => top - i).filter((h) => h >= 0)
  const shared = (h: number) => {
    const x = a.chain.find((c) => c.height === h)
    return !!x && byHeightB.get(h)?.hash === x.hash
  }
  const split = [...a.chain].reverse().find((x) => byHeightB.has(x.height) && byHeightB.get(x.height)!.hash !== x.hash)
  const cell = (x: BlockSummary | undefined, h: number, side: 'a' | 'b') =>
    !x ? <span className="fork-cell empty" /> : (
      <span className={`fork-cell ${shared(h) ? 'same' : side}`}>
        <b>#{x.height}</b> {modeName(x.mode)} <span className="mono">{short(x.hash, 4)}</span>
      </span>
    )

  return (
    <section className="card">
      <div className="row between">
        <h2>Fork watch</h2>
        <span className={`chip ${split ? 'bad' : 'ok'}`}>{split ? `Split at block ${split.height}` : 'Same chain'}</span>
      </div>
      <div className="fork-grid">
        <span className="fork-head">This node · {modeName(a.info.nextMode ?? a.info.mode)} rules</span>
        <span className="fork-head">Second node · {modeName(b.info.nextMode ?? b.info.mode)} rules{b.info.oldRules ? ' (old rules)' : ''}</span>
        {heights.map((h) => (
          <div className="fork-row" key={h}>
            {cell(a.chain.find((c) => c.height === h), h, 'a')}
            {cell(byHeightB.get(h), h, 'b')}
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        The second node runs the old rules, so it rejects every block made under the new ones, and the miners connected to it keep extending the old chain.
        Same history up to the switch, two chains after it.
      </p>
    </section>
  )
}
