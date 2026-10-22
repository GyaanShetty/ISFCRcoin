import { useEffect, useState } from 'react'
import { api } from '../api'
import { Big } from './Big'
import { shortAddr } from '../format'
import { useLive } from '../live'
import { useLottery } from '../lottery'
import { useWallet } from '../wallet'
import { Tip } from './Tip'

/** VRF Lottery home panel: your ticket and rank, the current lowest ticket, and the catch. */
export function LotteryPanel() {
  const { key } = useWallet()
  const live = useLive()
  const l = useLottery()
  const [now, setNow] = useState(Date.now())
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion])

  const s = l.status
  const me = key?.address
  const best = s?.best
  const bestName = !best ? 'nobody yet' : best.address === me ? 'You' : names[best.address] ?? shortAddr(best.address)
  const secs = s ? Math.max(0, Math.ceil((s.opensAt - now) / 1000)) : 0

  return (
    <>
      <Tip id="lottery-relax">Nothing to do this round. Your phone already holds a ticket for every block, and the lowest ticket wins. One address gets one ticket, so the catch is people making extra addresses.</Tip>
      <div className="grid2">
        <div className="tile orange">
          <span className="label">Your ticket</span>
          <Big v={l.myTicket ? l.myTicket.value.slice(0, 5) : '…'} size="md" />
          <span className="foot">{l.rank ? `#${l.rank} of ${s?.entries ?? '?'}` : l.error || 'drawing…'} · lowest wins</span>
        </div>
        <div className={`tile ${best?.address === me ? 'paper' : 'blue'}`}>
          <span className="label">Lowest ticket</span>
          <Big v={bestName} size="name" />
          <span className="foot">{best ? `${best.value.slice(0, 5)} · ` : ''}{secs > 0 ? `draw closes in ${secs}s` : 'winner is proposing'}</span>
        </div>
      </div>

      {l.won.length > 0 && (
        <div className="pills">
          {l.won.slice(0, 4).map((w, i) => <span key={i} className={`chip ${w.status === 'added' ? 'ok' : 'bad'}`}>#{w.height} {w.status === 'added' ? 'won' : w.status}</span>)}
        </div>
      )}
    </>
  )
}
