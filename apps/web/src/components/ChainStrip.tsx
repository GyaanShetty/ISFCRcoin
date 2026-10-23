import { useEffect, useRef, useState } from 'react'
import { allow } from '../motion'
import { api, type BlockSummary } from '../api'
import { initials, modeName, short } from '../format'
import { useLive } from '../live'
import { useWallet } from '../wallet'

/** The last few blocks as linked cards. New blocks slide in from the right; yours are orange. */
export function ChainStrip() {
  const live = useLive()
  const { key } = useWallet()
  const [blocks, setBlocks] = useState<BlockSummary[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const animated = useRef(new Map<string, boolean>()) // block hash → did it get the slide-in
  useEffect(() => {
    api.chain(6).then(setBlocks).catch(() => {})
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion])
  if (blocks.length === 0) return null
  return (
    <section className="card">
      <div className="row between"><h3>The chain</h3><a href="#/learn/chain" className="hint">Explorer ›</a></div>
      <div className="strip">
        {blocks.map((b) => {
          if (!animated.current.has(b.hash)) animated.current.set(b.hash, animated.current.size > 0 && allow('strip', 4000))
          const mine = b.proposer === key?.address
          const who = b.height === 0 ? 'Genesis' : mine ? 'You' : names[b.proposer] ?? short(b.proposer.slice(6), 3)
          return (
            <div key={b.hash} className={`strip-block ${mine ? 'mine' : ''} ${animated.current.get(b.hash) ? 'enter' : ''}`}>
              <span className="strip-h">#{b.height}</span>
              <span className="strip-who"><i>{initials(who)}</i>{who}</span>
              <span className="strip-hash mono">{b.hash.slice(0, 6)}</span>
              <span className="strip-mode">{modeName(b.mode)}</span>
            </div>
          )
        })}
      </div>
      <p className="hint" style={{ margin: '10px 0 0' }}>Each block stores the one before it's hash. That link is the chain.</p>
    </section>
  )
}
