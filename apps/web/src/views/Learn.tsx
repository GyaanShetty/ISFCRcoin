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
import { Glossary, Lessons } from './Lessons'
import { AttackLab, HashLab, NonceLab } from './Labs'
import { LESSONS } from '../teach'
import { useProgress } from '../progress'

const SECTIONS = [
  { id: 'lessons', title: 'Lessons', blurb: 'Every ruleset, explained, with a check question', cls: 'paper', view: Lessons },
  { id: 'glossary', title: 'Glossary', blurb: 'Hash, nonce, Merkle root, stake…', cls: 'dark', view: Glossary },
  { id: 'hash', title: 'Hash lab', blurb: 'Change one letter, watch the fingerprint scramble', cls: 'blue', view: HashLab },
  { id: 'mine', title: 'Mine by hand', blurb: 'Find a nonce yourself; feel each zero get 16x harder', cls: 'orange', view: NonceLab },
  { id: 'attack', title: '51% attack race', blurb: 'Can a secret chain overtake the real one?', cls: 'paper', view: AttackLab },
  { id: 'block', title: 'Inside your block', blurb: 'Pick transactions, see the header and Merkle tree', cls: 'orange', view: BlockInside },
  { id: 'chain', title: 'Explorer', blurb: 'Every block the class has mined', cls: 'blue', view: Explorer },
  { id: 'tamper', title: 'Tamper lab', blurb: 'Try to rewrite history', cls: 'paper', view: TamperLab },
  { id: 'sign', title: 'Sign & verify', blurb: 'Prove a message is yours', cls: 'dark', view: SignVerify },
  { id: 'vote', title: 'Change the rules', blurb: 'Propose and vote on a consensus switch', cls: 'orange', view: GovernancePage },
] as const

export function Learn({ sub }: { sub: string }) {
  const [id, rest = ''] = sub.split('/')
  const section = SECTIONS.find((s) => s.id === id)
  if (section) {
    const View = section.view as (p: { sub: string }) => JSX.Element | null
    return (
      <div className="stack">
        <div className="row between">
          <a href="#/learn"><button className="ghost">← Learn</button></a>
          <h2>{section.title}</h2>
        </div>
        <View sub={rest} />
      </div>
    )
  }
  return (
    <div className="stack">
      <h1>Learn</h1>
      <ProgressCard />
      <Tip id="learn-optional">Optional. Open any of these to see how blocks, hashes and signatures work.</Tip>
      <div className="grid2 wide-4">
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

/** How far along you are: rulesets tried in class, lesson checks passed. */
function ProgressCard() {
  const p = useProgress()
  const total = LESSONS.length
  const pct = Math.round((100 * (p.tried.length + p.passed.length)) / (2 * total))
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <section className="card progress-card">
      <svg viewBox="0 0 80 80" className="ring" aria-hidden="true">
        <circle cx="40" cy="40" r={r} className="ring-bg" />
        <circle cx="40" cy="40" r={r} className="ring-fg" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - pct / 100) }} />
        <text x="40" y="45" textAnchor="middle">{pct}%</text>
      </svg>
      <div>
        <div className="t">{p.tried.length} of {total} rulesets tried</div>
        <div className="s">{p.passed.length} lesson checks passed · {Object.values(p.wins).reduce((a, b) => a + b, 0)} blocks made</div>
      </div>
    </section>
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
