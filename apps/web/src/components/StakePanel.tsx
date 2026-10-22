import { useEffect, useState } from 'react'
import { TxType, UNIT, parseISFCR, signTx } from '@isfcr/core'
import { api, type AccountView } from '../api'
import { Big } from './Big'
import { coins, shortAddr } from '../format'
import { useLive } from '../live'
import { useValidator, validator } from '../validator'
import { useWallet } from '../wallet'
import { Tip } from './Tip'

/** Proof of Stake home panel: your stake and odds, who proposes now, stake controls, and a way to cheat. */
export function StakePanel({ acct }: { acct: AccountView | null }) {
  const { key } = useWallet()
  const live = useLive()
  const v = useValidator()
  const [now, setNow] = useState(Date.now())
  const [names, setNames] = useState<Record<string, string>>({})
  const [amount, setAmount] = useState('25')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion])

  const s = v.status
  const me = key?.address
  const mine = s?.stakers.find((x) => x.address === me)
  const leaderName = !s?.leader ? 'nobody' : s.leader === me ? 'You' : names[s.leader] ?? shortAddr(s.leader)
  const secs = (t: number) => Math.max(0, Math.ceil((t - now) / 1000))
  const timing = !s ? '' : now < s.opensAt ? `slot opens in ${secs(s.opensAt)}s` : `if they miss it, next pick in ${secs(s.nextRoundAt)}s`

  async function send(type: TxType.Stake | TxType.Unstake) {
    setMsg('')
    try {
      const state = live.info!
      const units = amount === 'all' ? BigInt(type === TxType.Stake ? acct!.balance : acct!.stake) - (type === TxType.Stake ? UNIT / 5n : 0n) : parseISFCR(amount)
      const tx = signTx({ chainId: state.chainId, nonce: acct!.nextNonce, fee: UNIT / 10n, body: { type, amount: units } }, key!.privateKey, key!.publicKey)
      await api.submitTx(tx)
      setMsg(`${type === TxType.Stake ? 'Staking' : 'Unstaking'} ${coins(units)} ISFCR. It counts once the next block is in.`)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const slash = live.lastSlash && now - live.lastSlash.at < 90_000 ? live.lastSlash : null

  return (
    <>
      {slash && (
        <div className="banner warn">
          {slash.proposer === me ? 'You' : names[slash.proposer] ?? shortAddr(slash.proposer)} signed two blocks at #{slash.height} and lost half their stake.
        </div>
      )}
      <div className="grid2">
        <div className="tile orange">
          <span className="label">Your stake</span>
          <Big v={acct ? coins(acct.stake) : '…'} small="ISFCR" />
          <span className="foot">{mine ? `${Math.round(mine.chance * 100)}% chance to be picked each block` : 'Stake coins to be picked'}</span>
        </div>
        <div className={`tile ${s?.leader === me ? 'paper' : 'blue'}`}>
          <span className="label">Proposing now</span>
          <Big v={leaderName} size="name" />
          <span className="foot">{s?.round ? `round ${s.round} · ` : ''}{timing}</span>
        </div>
      </div>

      <Tip id="pos-stake">The rules changed: no more guessing. Stake some coins below. The more you stake, the more often you are picked to make a block, and your phone does that part on its own.</Tip>
      <section className="card stack">
        <div className="row between"><h3>Stake</h3><span className="hint">{s ? `${coins(s.totalStake)} ISFCR staked by ${s.stakers.length}` : ''}</span></div>
        <div className="pills">
          {['10', '25', '50', 'all'].map((a) => <button key={a} className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>{a === 'all' ? 'All' : a}</button>)}
        </div>
        <div className="grid2">
          <button className="primary" disabled={!acct} onClick={() => send(TxType.Stake)}>Stake</button>
          <button className="white" disabled={!acct || acct.stake === '0'} onClick={() => send(TxType.Unstake)}>Unstake</button>
        </div>
        {msg && <div className="hint">{msg}</div>}
      </section>

      {v.proposed.length > 0 && (
        <div className="pills">
          {v.proposed.slice(0, 4).map((p, i) => <span key={i} className={`chip ${p.status === 'added' ? 'ok' : 'bad'}`}>#{p.height} {p.status === 'added' ? 'proposed' : p.status}</span>)}
        </div>
      )}

      <section className="card">
        <details>
          <summary>Try to cheat</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <p className="hint" style={{ margin: 0 }}>
              When it's your turn, you could sign <b>two different blocks</b> for the same slot and try to split the class.
              Both carry your signature, so anyone can prove you cheated and burn half your stake.
            </p>
            <button className={v.armed ? 'white' : 'primary'} disabled={!mine} onClick={() => validator.arm(!v.armed)}>
              {!mine ? 'Stake first' : v.armed ? 'Armed: will double-sign on my turn (tap to cancel)' : 'Double-sign on my next turn'}
            </button>
            {v.cheatResult && <div className="hint">{v.cheatResult}</div>}
          </div>
        </details>
      </section>
    </>
  )
}
