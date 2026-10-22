import { useEffect, useState } from 'react'
import { api, type HistoryItem } from '../api'
import { ago, coins, shortAddr } from '../format'
import { useLive } from '../live'
import { useWallet } from '../wallet'

const LABEL: Record<HistoryItem['kind'], string> = {
  mined: 'Made a block', sent: 'Sent', received: 'Received', staked: 'Staked', unstaked: 'Unstaked',
  proposed: 'Proposed a rule change', voted: 'Voted', faucet: 'Faucet gift',
}
const SIGN: Partial<Record<HistoryItem['kind'], string>> = { mined: '+', received: '+', faucet: '+', sent: '−', staked: '−', unstaked: '+' }

/** Everything that touched your address, newest first; pending items are marked. */
export function Activity() {
  const { key } = useWallet()
  const live = useLive()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key) return
    api.history(key.address).then(setItems).catch(() => {})
    api.names().then(setNames).catch(() => {})
  }, [key?.address, live.tipVersion, live.mempoolVersion])
  if (!key) return null
  return (
    <section className="card">
      <h3>Activity</h3>
      {items.length === 0 && <p className="muted">Nothing yet. Mine, send or stake and it shows up here.</p>}
      <div className="list">
        {items.map((i, n) => (
          <div key={n} className={`item act ${i.kind}`}>
            <span className="act-dot" />
            <div className="main" style={{ flex: 1 }}>
              <div className="t">{LABEL[i.kind]}{i.counterparty ? ` ${i.kind === 'sent' ? 'to' : 'from'} ${names[i.counterparty] ?? shortAddr(i.counterparty)}` : ''}{i.detail && i.kind !== 'mined' ? `: ${i.detail}` : ''}</div>
              <div className="s">{i.height === null ? 'waiting for the next block' : `block ${i.height} · ${ago(i.timestamp)}`}</div>
            </div>
            {i.amount !== '0' && <span className={`fee ${SIGN[i.kind] === '+' ? 'ok' : ''}`}>{SIGN[i.kind] ?? ''}{coins(i.amount)}</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
