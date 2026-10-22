import { type Tx, bytesToHex, merkleLevels, txHash } from '@isfcr/core'

/** Draws the Merkle tree root-first; odd levels duplicate their last node, shown dimmed. */
export function MerkleTree({ txs }: { txs: Tx[] }) {
  const levels = merkleLevels(txs.map(txHash)).map((l) => l.map(bytesToHex))
  const rows = [...levels].reverse()
  return (
    <div className="merkle" aria-label="Merkle tree">
      {rows.map((row, r) => {
        const isLeaves = r === rows.length - 1
        const padded = !isLeaves && levels[levels.length - 1 - r - 1]?.length % 2 === 1
        return (
          <div className="merkle-row" key={r}>
            {row.map((h, i) => (
              <div className={`merkle-node ${r === 0 ? 'root' : ''}`} key={i} title={h}>
                <span className="mono">{h.slice(0, 8)}</span>
                {isLeaves && <span className="merkle-label">{i === 0 ? 'coinbase' : `tx ${i}`}</span>}
              </div>
            ))}
            {padded && <div className="merkle-dup">↳ last hash below paired with itself</div>}
          </div>
        )
      })}
      <div className="hint">root = merkleRoot in the header. Change any tx and the root changes.</div>
    </div>
  )
}
