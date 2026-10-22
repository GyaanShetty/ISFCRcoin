import { useEffect, useState } from 'react'
import {
  type Block, type Tx, TxType, blockFromJSON, bytesToHex, computeMerkleRoot, formatISFCR, hashMeetsTarget,
  hexToBytes, headerHash, isCoinbase, mineRange, parseISFCR, txToJSON,
} from '@isfcr/core'
import { api, type BlockSummary } from '../api'
import { MerkleTree } from '../components/MerkleTree'
import { ago, isfcr, modeName, short, shortAddr } from '../format'
import { useLive } from '../live'
import { useWallet } from '../wallet'

export function Explorer() {
  const live = useLive()
  const { key } = useWallet()
  const [blocks, setBlocks] = useState<BlockSummary[]>([])
  const [open, setOpen] = useState<any | null>(null)

  useEffect(() => {
    api.chain(30).then((b) => setBlocks(b.reverse())).catch(() => {})
  }, [live.tipVersion])

  if (open) return <BlockDetail json={open} onClose={() => setOpen(null)} />
  return (
    <section className="card">
      <div className="row between"><h3>Latest blocks</h3><span className="hint">height {live.info?.height ?? '…'}</span></div>
      {live.reorgDepth > 0 && <div className="banner warn" style={{ marginTop: 10 }}>A fork just resolved: {live.reorgDepth} block(s) were replaced by a longer branch.</div>}
      <div className="list" style={{ marginTop: 6 }}>
        {blocks.map((b) => (
          <button key={b.hash} className={`item ${b.proposer === key?.address ? 'hl' : ''}`} onClick={() => api.block(b.hash).then(setOpen)}>
            <div className="main">
              <div className="t">#{b.height} · {b.height === 0 ? 'genesis' : b.proposer === key?.address ? 'mined by you' : shortAddr(b.proposer)}</div>
              <div className="s mono">{short(b.hash, 8)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="fee">{b.txCount} tx</div>
              <div className="s">{ago(b.timestamp)}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export function txLine(tx: Tx): string {
  if (isCoinbase(tx)) return `Reward → ${shortAddr(tx.to)}: ${isfcr(tx.amount)}`
  const b = tx.body
  if (b.type === TxType.Transfer) return `${isfcr(b.amount)} → ${shortAddr(b.to)}`
  return TxType[b.type]
}

function BlockDetail({ json, onClose }: { json: any; onClose: () => void }) {
  const block = blockFromJSON(json)
  const h = json.header
  return (
    <div className="stack">
      <button className="ghost" style={{ alignSelf: 'flex-start' }} onClick={onClose}>← All blocks</button>
      <section className="card">
        <h2>Block #{h.height}</h2>
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>hash</dt><dd className="mono wrap">{json.hash}</dd>
          <dt>prevHash</dt><dd className="mono wrap">{h.prevHash}</dd>
          <dt>merkleRoot</dt><dd className="mono wrap">{h.merkleRoot}</dd>
          <dt>time</dt><dd>{new Date(h.timestamp).toLocaleTimeString()}</dd>
          <dt>mode</dt><dd>{modeName(h.mode)}</dd>
          <dt>miner</dt><dd className="mono wrap">{h.proposer}</dd>
          <dt>nonce</dt><dd className="mono">{h.nonce}</dd>
        </dl>
      </section>
      <section className="card">
        <h3>Transactions</h3>
        <div className="list">
          {block.txs.map((tx, i) => (
            <div className="item" key={i}>
              <div className="main"><div className="t">{txLine(tx)}</div>{!isCoinbase(tx) && <div className="s">fee {isfcr(tx.fee)}</div>}</div>
              {!isCoinbase(tx) && <button className="small" onClick={() => navigator.clipboard?.writeText(JSON.stringify(txToJSON(tx))).catch(() => {})}>Copy</button>}
            </div>
          ))}
        </div>
        {block.txs.length > 0 && <MerkleTree txs={block.txs} />}
      </section>
    </div>
  )
}

// ---- Tamper lab: edit an old tx locally and watch every later link break ----

interface LabBlock { original: Block; originalHash: string; edited: Block }

export function TamperLab() {
  const live = useLive()
  const [items, setItems] = useState<LabBlock[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const tip = live.info?.height ?? 0
    const from = Math.max(1, tip - 3)
    Promise.all(Array.from({ length: Math.max(0, tip - from + 1) }, (_, i) => api.block(from + i))).then((js) =>
      setItems(js.map((j) => ({ original: blockFromJSON(j), originalHash: j.hash, edited: blockFromJSON(j) }))))
    // A snapshot to play with; deliberately loaded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const derived = items.map((it) => {
    const header = { ...it.edited.header, merkleRoot: computeMerkleRoot(it.edited.txs) }
    const hash = headerHash(header)
    return { header, hash: bytesToHex(hash), powOk: hashMeetsTarget(hash, header.target) }
  })

  const editAmount = (bi: number, ti: number, value: string) =>
    setItems((prev) => prev.map((it, i) => i !== bi ? it : {
      ...it,
      edited: {
        ...it.edited,
        txs: it.edited.txs.map((tx, j) => {
          if (j !== ti || isCoinbase(tx) || tx.body.type !== TxType.Transfer) return tx
          try { return { ...tx, body: { ...tx.body, amount: parseISFCR(value) } } } catch { return tx }
        }),
      },
    }))

  // Redo block bi's proof of work on top of the tampered parent, like an attacker would.
  const remine = async (bi: number) => {
    setBusy(bi)
    const prevHash = bi > 0 ? hexToBytes(derived[bi - 1].hash) : items[bi].edited.header.prevHash
    const header = { ...derived[bi].header, prevHash }
    const t0 = Date.now()
    for (let nonce = 0n; ; nonce += 5000n) {
      const r = mineRange(header, nonce, 5000)
      if (r) {
        setItems((prev) => prev.map((it, i) => i === bi ? { ...it, edited: { ...it.edited, header: { ...header, nonce: r.nonce } } } : it))
        setMsg(`Re-mined #${header.height} in ${((Date.now() - t0) / 1000).toFixed(1)}s, but the next block is broken now. To fake history you must redo every block after it, faster than the whole class.`)
        break
      }
      await new Promise((res) => setTimeout(res, 0))
    }
    setBusy(null)
  }

  return (
    <div className="stack">
      <section className="card">
        <h3>Change history?</h3>
        <p className="hint" style={{ marginBottom: 0 }}>This is a local copy of the last few blocks. Edit any amount below and watch the hashes. Nothing is sent to the network.</p>
        {msg && <p className="ok" style={{ marginBottom: 0 }}>{msg}</p>}
      </section>
      {items.map((it, bi) => {
        const d = derived[bi]
        const changed = d.hash !== it.originalHash
        const linked = bi === 0 || bytesToHex(it.edited.header.prevHash) === derived[bi - 1].hash
        return (
          <section key={it.originalHash} className={`card lab ${changed || !linked ? 'broken' : ''}`}>
            <div className="row between">
              <h3>Block #{it.edited.header.height}</h3>
              {bi > 0 && <span className={`chip ${linked ? 'ok' : 'bad'}`}>{linked ? 'linked to parent' : 'broken link'}</span>}
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>points to</dt><dd className="mono">{short(bytesToHex(it.edited.header.prevHash), 8)}</dd>
              <dt>hash</dt><dd className={`mono ${changed ? 'bad' : ''}`}>{short(d.hash, 8)}</dd>
              <dt>proof of work</dt><dd className={d.powOk ? 'ok' : 'bad'}>{d.powOk ? 'valid' : 'no longer valid'}</dd>
            </dl>
            <div className="list" style={{ marginTop: 8 }}>
              {it.edited.txs.map((tx, ti) => (
                <div className="item" key={ti}>
                  {isCoinbase(tx) || tx.body.type !== TxType.Transfer ? <span className="s">{txLine(tx)}</span> : (
                    <>
                      <span className="s">→ {shortAddr(tx.body.to)}</span>
                      <input className="amount" defaultValue={formatISFCR(tx.body.amount)} onChange={(e) => editAmount(bi, ti, e.target.value)} />
                    </>
                  )}
                </div>
              ))}
            </div>
            {(changed || !linked) && (
              <button className="primary" style={{ marginTop: 12 }} disabled={busy !== null} onClick={() => remine(bi)}>
                {busy === bi ? 'Re-mining…' : 'Re-mine it (be the attacker)'}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
