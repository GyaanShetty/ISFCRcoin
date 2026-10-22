import {
  type Address, type ChainState, type SignedTx, PARAMS, TxType, ValidationError, applyTx, bytesToHex, cloneState,
  getAccount, txId, txSender, verifyTxSignature,
} from '@isfcr/core'

export interface PoolEntry {
  id: string
  tx: SignedTx
  sender: Address
  receivedAt: number
}

const MAX_POOL = 5000
const MAX_PENDING_PER_SENDER = 50

function spendOf(tx: SignedTx): bigint {
  const b = tx.body
  const amount = b.type === TxType.Transfer || b.type === TxType.Stake ? b.amount : 0n
  return amount + tx.fee
}

/**
 * Governance txs that can never be mined on top of `state` (the next block is at
 * or past the activation height, or the vote has closed). Without this they'd sit
 * in the mempool forever, skipped by every miner.
 */
function staleGovernance(tx: SignedTx, state: ChainState): string | null {
  const next = state.height + 1
  const b = tx.body
  if (b.type === TxType.ProposeConsensus && b.activateAt <= next) return `activation height ${b.activateAt} has already been reached`
  if (b.type === TxType.Vote) {
    const p = state.proposals.get(b.proposalId)
    if (!p) return 'unknown proposal'
    if (next >= p.activateAt) return 'voting on this proposal has closed'
  }
  return null
}

const byFee = (a: PoolEntry, b: PoolEntry) =>
  a.tx.fee === b.tx.fee ? a.receivedAt - b.receivedAt : a.tx.fee > b.tx.fee ? -1 : 1

/**
 * Pending transactions, prioritised by fee. Per-sender nonces must be contiguous
 * from the account's on-chain nonce; a same-nonce tx with a higher fee replaces
 * the old one (replace-by-fee).
 */
export class Mempool {
  private entries = new Map<string, PoolEntry>()
  /** Bumped on every change, so callers can cache work derived from the pool. */
  version = 0
  private selectCache: { key: string; txs: SignedTx[] } | null = null

  /** `exempt` senders (the faucet) may exceed the per-sender pending cap. */
  constructor(private exempt: Set<Address> = new Set()) {}

  get size(): number {
    return this.entries.size
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get(id: string): PoolEntry | undefined {
    return this.entries.get(id)
  }

  list(limit = Infinity): PoolEntry[] {
    return [...this.entries.values()].sort(byFee).slice(0, limit)
  }

  private bySender(sender: Address): PoolEntry[] {
    return [...this.entries.values()].filter((e) => e.sender === sender).sort((a, b) => a.tx.nonce - b.tx.nonce)
  }

  /** Nonce the sender's next tx should use, counting pending txs. */
  nextNonce(state: ChainState, addr: Address): number {
    return getAccount(state, addr).nonce + this.bySender(addr).length
  }

  /** Validates against the tip state plus the sender's pending txs. Returns the tx id. */
  add(tx: SignedTx, state: ChainState): { id: string; replaced?: string } {
    const id = txId(tx)
    if (this.entries.has(id)) return { id }
    if (tx.chainId !== state.genesis.chainId) throw new ValidationError('wrong chainId')
    if (tx.fee < PARAMS.MIN_FEE) throw new ValidationError('fee below minimum (0.1 ISFCR)')
    if (!verifyTxSignature(tx)) throw new ValidationError('bad signature')
    const b = tx.body
    if ((b.type === TxType.Transfer || b.type === TxType.Stake || b.type === TxType.Unstake) && b.amount <= 0n) {
      throw new ValidationError('amount must be positive')
    }

    const stale = staleGovernance(tx, state)
    if (stale) throw new ValidationError(stale)

    const sender = txSender(tx)
    const acc = getAccount(state, sender)
    const pending = this.bySender(sender)
    if (tx.nonce < acc.nonce) throw new ValidationError(`nonce too low: account is at ${acc.nonce}`)
    if (tx.nonce > acc.nonce + pending.length) throw new ValidationError(`nonce gap: next is ${acc.nonce + pending.length}`)
    if (pending.length >= MAX_PENDING_PER_SENDER && !this.exempt.has(sender)) throw new ValidationError('too many pending txs from this sender')

    const existing = pending.find((e) => e.tx.nonce === tx.nonce)
    if (existing && tx.fee <= existing.tx.fee) throw new ValidationError('a tx with this nonce is pending; raise the fee to replace it')

    const committed = pending.filter((e) => e !== existing).reduce((sum, e) => sum + spendOf(e.tx), 0n)
    if (committed + spendOf(tx) > acc.balance) throw new ValidationError('insufficient balance (including pending txs)')

    if (this.entries.size >= MAX_POOL && !existing) {
      const lowest = this.list().at(-1)!
      if (lowest.tx.fee >= tx.fee) throw new ValidationError('mempool full; fee too low')
      this.entries.delete(lowest.id)
    }
    if (existing) this.entries.delete(existing.id)
    this.entries.set(id, { id, tx, sender, receivedAt: Date.now() })
    this.version++
    return { id, replaced: existing?.id }
  }

  clear(): void {
    this.entries.clear()
    this.version++
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) this.entries.delete(id)
    this.version++
  }

  /** Drops txs that the new tip state has made invalid (mined, stale nonce, unaffordable). */
  prune(state: ChainState): string[] {
    const dropped: string[] = []
    const senders = new Set([...this.entries.values()].map((e) => e.sender))
    for (const sender of senders) {
      const acc = getAccount(state, sender)
      let expected = acc.nonce
      let budget = acc.balance
      for (const e of this.bySender(sender)) {
        const cost = spendOf(e.tx)
        if (e.tx.nonce !== expected || cost > budget || staleGovernance(e.tx, state)) {
          this.entries.delete(e.id)
          dropped.push(e.id)
          continue
        }
        expected++
        budget -= cost
      }
    }
    if (dropped.length) this.version++
    return dropped
  }

  /**
   * Picks the highest-fee txs that apply cleanly on top of `state`, respecting
   * per-sender nonce order. applyTx validates before mutating, so a failed
   * attempt leaves the trial state untouched.
   */
  select(state: ChainState, max: number = PARAMS.MAX_TXS_PER_BLOCK, only?: Set<string>): SignedTx[] {
    // The default (best-fee) selection is the same for every miner on a given tip and pool.
    const key = only ? null : `${bytesToHex(state.tipHash)}:${this.version}:${max}`
    if (key && this.selectCache?.key === key) return this.selectCache.txs
    const txs = this.selectUncached(state, max, only)
    if (key) this.selectCache = { key, txs }
    return txs
  }

  private selectUncached(state: ChainState, max: number, only?: Set<string>): SignedTx[] {
    const trial = cloneState(state)
    const height = state.height + 1
    let remaining = this.list().filter((e) => !only || only.has(e.id))
    const chosen: SignedTx[] = []
    let progress = true
    while (progress && chosen.length < max) {
      progress = false
      const next: PoolEntry[] = []
      for (const e of remaining) {
        if (chosen.length >= max) break
        try {
          applyTx(trial, e.tx, height)
          chosen.push(e.tx)
          progress = true
        } catch {
          next.push(e)
        }
      }
      remaining = next
    }
    return chosen
  }
}
