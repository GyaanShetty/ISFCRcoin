import { useEffect, useState } from 'react'
import { TxType, UNIT, signTx } from '@isfcr/core'
import { api, type Proposal } from '../api'
import { coins, modeName, shortAddr } from '../format'
import { useLive } from '../live'
import { getWallet, useWallet } from '../wallet'
import { Tip } from './Tip'

function useProposals() {
  const live = useLive()
  const [list, setList] = useState<Proposal[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    api.proposals().then(setList).catch(() => {})
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion, live.mempoolVersion])
  return { list, names }
}

async function sendGov(body: any): Promise<void> {
  const key = getWallet().key!
  const acct = await api.account(key.address)
  const info = await api.info()
  await api.submitTx(signTx({ chainId: info.chainId, nonce: acct.nextNonce, fee: UNIT / 10n, body }, key.privateKey, key.publicKey))
}

/** Support bar with the 50% line that a holder proposal must reach. */
function Tally({ p }: { p: Proposal }) {
  const total = Number(BigInt(p.circulating) / (UNIT / 100n)) || 1
  const yes = Number(BigInt(p.support) / (UNIT / 100n))
  const no = Number(BigInt(p.against) / (UNIT / 100n))
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ position: 'relative', height: 14, borderRadius: 7, background: 'var(--card-2)', overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (100 * yes) / total)}%`, background: 'var(--orange)' }} />
        <span style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${Math.min(100, (100 * no) / total)}%`, background: 'var(--muted)' }} />
        <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, borderLeft: '2px solid var(--paper)' }} />
      </div>
      <div className="row between hint" style={{ marginTop: 6 }}>
        <span>Yes {coins(p.support)} · No {coins(p.against)}</span>
        <span>needs {coins(BigInt(p.circulating) / 2n)} of {coins(p.circulating)}</span>
      </div>
    </div>
  )
}

/** Home-screen card: vote on the open proposal you haven't voted on yet. */
export function VoteCard() {
  const { key } = useWallet()
  const { list, names } = useProposals()
  const [msg, setMsg] = useState('')
  const live = useLive()
  const p = list.find((x) => x.open && !x.byInstructor)
  if (!p || !key) return null
  const voted = p.votesFor.includes(key.address) || p.votesAgainst.includes(key.address)
  const left = p.activateAt - (live.info?.height ?? 0) - 1
  const vote = async (approve: boolean) => {
    try {
      await sendGov({ type: TxType.Vote, proposalId: p.id, approve })
      setMsg('Vote sent. It counts once the next block is in.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <>
    {!voted && <Tip id={`vote-${p.id}`}>The class is voting on a rule change. Your vote counts in proportion to the coins you hold.</Tip>}
    <section className="tile paper" style={{ minHeight: 0 }}>
      <span className="label">Class vote · {left} block{left === 1 ? '' : 's'} left</span>
      <h2 style={{ margin: '8px 0 0' }}>Switch to {p.modeName}?</h2>
      <span className="foot">Proposed by {p.proposer === key.address ? 'you' : names[p.proposer] ?? shortAddr(p.proposer)}. Your vote weighs as much as the coins you hold.</span>
      <Tally p={p} />
      {voted ? <p className="foot" style={{ marginBottom: 0 }}>You voted</p> : (
        <div className="grid2" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => vote(true)}>Yes</button>
          <button onClick={() => vote(false)} style={{ background: '#d9d9de', color: 'var(--paper-ink)' }}>No</button>
        </div>
      )}
      {msg && <p className="foot" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
    </>
  )
}

/** Learn → Governance: every proposal, and a form to propose a switch. */
export function GovernancePage() {
  const { key } = useWallet()
  const live = useLive()
  const { list, names } = useProposals()
  const modes = (live.info?.implementedModes ?? []).filter((m) => m !== live.info?.mode)
  const [mode, setMode] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  const propose = async () => {
    try {
      const info = await api.info()
      await sendGov({ type: TxType.ProposeConsensus, mode: mode!, activateAt: info.height + 20 })
      setMsg('Proposal sent. Classmates have ~20 blocks (about 5 minutes) to vote.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h3>Propose a switch</h3>
        <p className="hint" style={{ margin: 0 }}>
          Changing the rules is itself a transaction. Holders vote with their coins; the switch passes once “yes” holds half of all coins in circulation,
          and every node activates it at the same block. (The instructor's key can skip the vote.)
        </p>
        <div className="pills">
          {modes.map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{modeName(m)}</button>)}
        </div>
        <button className="primary" disabled={mode === null || !key} onClick={propose}>Propose (vote closes in 20 blocks)</button>
        {msg && <div className="hint">{msg}</div>}
      </section>
      <section className="card">
        <h3>All proposals</h3>
        {list.length === 0 && <p className="muted">None yet.</p>}
        <div className="list">
          {list.map((p) => (
            <div key={p.id} className="item" style={{ display: 'block' }}>
              <div className="row between">
                <span className="t">{p.modeName} at #{p.activateAt}</span>
                <span className={`chip ${p.passed ? 'ok' : p.open ? '' : 'bad'}`}>{p.passed ? 'passed' : p.open ? 'voting' : 'failed'}</span>
              </div>
              <div className="s">{p.byInstructor ? 'Instructor decision' : `by ${names[p.proposer] ?? shortAddr(p.proposer)}`}</div>
              {!p.byInstructor && <Tally p={p} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

