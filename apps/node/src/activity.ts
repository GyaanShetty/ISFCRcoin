import { type Address, ConsensusMode, TxType, addressFromPublicKey, txId } from '@isfcr/core'
import type { ChainNode } from './chain'
import type { IsfcrNode } from './node'

export interface HistoryItem {
  kind: 'mined' | 'sent' | 'received' | 'staked' | 'unstaked' | 'proposed' | 'voted' | 'faucet'
  height: number | null // null = still pending
  timestamp: number
  amount: string
  fee?: string
  counterparty?: Address
  txid?: string
  detail?: string
}

export interface ClassEvent {
  at: number
  kind: 'block' | 'switch-scheduled' | 'switch' | 'slash' | 'reset'
  height: number
  text: string
  who?: Address
  mode?: number
}

const MAX_EVENTS = 60

/**
 * Per-account history (built from the main chain plus the mempool) and a short log of
 * class-wide events for the projector feed.
 */
export class Activity {
  private events: ClassEvent[] = []
  private lastMode: number | null = null

  constructor(private node: IsfcrNode) {}

  log(e: ClassEvent): void {
    this.events.unshift(e)
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
    this.node.emit('event', e)
  }

  recent(): ClassEvent[] {
    return this.events
  }

  clear(): void {
    this.events = []
    this.lastMode = null
  }

  onTip(tip: ChainNode): void {
    const h = tip.block.header
    if (this.lastMode !== null && h.mode !== this.lastMode) {
      this.log({ at: Date.now(), kind: 'switch', height: h.height, mode: h.mode, text: `Rules switched to ${ConsensusMode[h.mode]}` })
    }
    this.lastMode = h.mode
    this.log({ at: Date.now(), kind: 'block', height: h.height, who: h.proposer, mode: h.mode, text: `Block ${h.height}: ${tip.block.txs.length - 1} transactions` })
    const sw = tip.state.scheduledSwitch
    if (sw && !this.events.some((e) => e.kind === 'switch-scheduled' && e.height === sw.activateAt)) {
      this.log({ at: Date.now(), kind: 'switch-scheduled', height: sw.activateAt, mode: sw.mode, text: `Switching to ${ConsensusMode[sw.mode]} at block ${sw.activateAt}` })
    }
  }

  history(addr: Address, limit = 60): HistoryItem[] {
    const out: HistoryItem[] = []
    const faucet = this.node.chain.genesis.faucetAddress
    const scan = (tx: any, height: number | null, ts: number) => {
      if (tx.type === TxType.Coinbase) {
        if (tx.to === addr) out.push({ kind: 'mined', height, timestamp: ts, amount: tx.amount.toString(), detail: 'block reward + fees' })
        return
      }
      const from = addressFromPublicKey(tx.publicKey)
      const b = tx.body
      const base = { height, timestamp: ts, txid: txId(tx), fee: tx.fee.toString() }
      if (b.type === TxType.Transfer) {
        if (from === addr) out.push({ ...base, kind: 'sent', amount: b.amount.toString(), counterparty: b.to })
        else if (b.to === addr) out.push({ ...base, kind: from === faucet ? 'faucet' : 'received', amount: b.amount.toString(), counterparty: from })
      } else if (from === addr) {
        if (b.type === TxType.Stake) out.push({ ...base, kind: 'staked', amount: b.amount.toString() })
        else if (b.type === TxType.Unstake) out.push({ ...base, kind: 'unstaked', amount: b.amount.toString() })
        else if (b.type === TxType.ProposeConsensus) out.push({ ...base, kind: 'proposed', amount: '0', detail: `switch to ${ConsensusMode[b.mode]}` })
        else if (b.type === TxType.Vote) out.push({ ...base, kind: 'voted', amount: '0', detail: b.approve ? 'yes' : 'no' })
      }
    }
    for (const e of this.node.mempool.list()) scan(e.tx, null, e.receivedAt)
    for (let h = this.node.chain.height; h >= 1 && out.length < limit; h--) {
      const n = this.node.chain.atHeight(h)!
      for (const tx of n.block.txs) scan(tx, h, n.block.header.timestamp)
    }
    return out.slice(0, limit)
  }
}
