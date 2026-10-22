import { useEffect, useState } from 'react'
import { ConsensusMode, TxType, blockFromJSON, bytesToHex, computeMerkleRoot } from '@isfcr/core'
import { api, type MempoolEntry } from '../api'
import { MerkleTree } from '../components/MerkleTree'
import { coins, isfcr, short, shortAddr } from '../format'
import { useLive } from '../live'
import { miner, useMiner } from '../miner'
import { Explorer, TamperLab } from './Explorer'
import { SignVerify } from './SignVerify'
import { GovernancePage } from '../components/Governance'
import { ShowTipsAgain, Tip } from '../components/Tip'

const SECTIONS = [
  { id: 'block', title: 'Inside your block', blurb: 'Pick transactions, see the header and Merkle tree', cls: 'orange', view: BlockInside },
  { id: 'chain', title: 'Explorer', blurb: 'Every block the class has mined', cls: 'blue', view: Explorer },
  { id: 'tamper', title: 'Tamper lab', blurb: 'Try to rewrite history', cls: 'paper', view: TamperLab },
  { id: 'sign', title: 'Sign & verify', blurb: 'Prove a message is yours', cls: 'dark', view: SignVerify },
  { id: 'vote', title: 'Change the rules', blurb: 'Propose and vote on a consensus switch', cls: 'orange', view: GovernancePage },
] as const

export function Learn({ sub }: { sub: string }) {
  const section = SECTIONS.find((s) => s.id === sub)
  if (section) {
    const View = section.view
    return (
      <div className="stack">
        <div className="row between">
          <a href="#/learn"><button className="ghost">← Learn</button></a>
          <h2>{section.title}</h2>
        </div>
        <View />
      </div>
    )
  }
  return (
    <div className="stack">
      <h1>Learn</h1>
      <Tip id="learn-optional">Optional. Open any of these to see how blocks, hashes and signatures work.</Tip>
      <div className="grid2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/learn/${s.id}`} className={`tile ${s.cls}`} style={{ textDecoration: 'none', minHeight: 150 }}>
            <span className="label" style={{ fontSize: 18, fontWeight: 600 }}>{s.title}</span>
            <span className="foot">{s.blurb} ›</span>
          </a>
        ))}
      </div>
      <ShowTipsAgain />
    </div>
  )
}

function describe(tx: any): string {
  const b = tx.body
  switch (b.type) {
    case TxType.Transfer: return `${isfcr(b.amount)} → ${shortAddr(b.to)}`
    case TxType.ProposeConsensus: return `Switch to ${ConsensusMode[b.mode]}`
    default: return TxType[b.type] ?? 'tx'
  }
}

function BlockInside() {
  const live = useLive()
  const m = useMiner()
  const [pool, setPool] = useState<{ size: number; txs: MempoolEntry[] }>({ size: 0, txs: [] })
  useEffect(() => {
    api.mempool(100).then(setPool).catch(() => {})
  }, [live.mempoolVersion])

  const t = m.template
  if (!t) return <div className="card">Loading…</div>
  const block = blockFromJSON(t.block)
  const h = t.block.header
  const merkleOk = bytesToHex(computeMerkleRoot(block.txs)) === h.merkleRoot
  const inBlock = new Set(t.block.txs.slice(1).map((x: any) => x.signature))
  const max = live.info?.params.maxTxsPerBlock ?? 20

  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <h3>Pick transactions</h3>
          <span className="hint">{pool.size} waiting · {max} fit</span>
        </div>
        <div className="pills" style={{ marginTop: 12 }}>
          <button className={m.picking === 'auto' ? 'on' : ''} onClick={() => miner.setPicking('auto')}>Best fees</button>
          <button className={m.picking === 'manual' ? 'on' : ''} onClick={() => miner.setPicking('manual')}>I'll choose</button>
        </div>
        <p className="hint">You keep every fee in your block, so “best fees” earns the most. Choose by hand to see what happens.</p>
        <div className="list">
          {pool.txs.slice(0, 40).map((e) => {
            const on = inBlock.has(e.tx.signature)
            const row = (
              <>
                <span className={`check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                <div className="main" style={{ flex: 1 }}><div className="t">{describe(e.tx)}</div><div className="s mono">from {shortAddr(e.sender)}</div></div>
                <span className="fee">{coins(e.tx.fee)}</span>
              </>
            )
            return m.picking === 'manual'
              ? <button key={e.id} className="item" onClick={() => miner.togglePick(e.id)}>{row}</button>
              : <div key={e.id} className="item">{row}</div>
          })}
        </div>
      </section>

      <section className="card">
        <h3>Block #{h.height} header</h3>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>prevHash</dt><dd className="mono">{short(h.prevHash, 10)}</dd>
          <dt>merkleRoot</dt><dd className="mono">{short(h.merkleRoot, 10)} {merkleOk && <span className="chip ok">checked</span>}</dd>
          <dt>time</dt><dd>{new Date(h.timestamp).toLocaleTimeString()}</dd>
          <dt>miner</dt><dd>you</dd>
          <dt>target</dt><dd className="mono">{short(h.target.padStart(64, '0'), 10)}</dd>
          <dt>nonce</dt><dd className="mono">{m.mining ? m.nonce || '…' : 'not mining'}</dd>
        </dl>
        <p className="hint">Prize: {isfcr(t.reward)} reward + {isfcr(t.fees)} fees.</p>
        <MerkleTree txs={block.txs} />
      </section>
    </div>
  )
}
