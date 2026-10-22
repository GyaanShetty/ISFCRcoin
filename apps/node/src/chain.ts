import { EventEmitter } from 'node:events'
import {
  type ApplyOptions, type Block, type ChainState, type GenesisConfig, applyBlock, bytesToHex,
  genesisBlock, genesisState, headerHash,
} from '@isfcr/core'

export interface ChainNode {
  hash: string
  block: Block
  state: ChainState // state after applying this block
  receivedAt: number
}

export interface TipChange {
  tip: ChainNode
  /** Blocks that left the main chain (old branch, tip-first). Empty unless this was a reorg. */
  removed: ChainNode[]
  /** Blocks that joined the main chain (oldest first). */
  added: ChainNode[]
}

export type AddResult =
  | { status: 'added'; hash: string; main: boolean }
  | { status: 'duplicate'; hash: string }
  | { status: 'orphan'; hash: string; missingParent: string }

const MAX_ORPHANS = 256

/**
 * In-memory block tree with per-block state snapshots. The heaviest branch
 * (cumulative work) is the main chain; switching branches emits a reorg.
 */
export class ChainStore extends EventEmitter {
  readonly genesisHash: string
  private nodes = new Map<string, ChainNode>()
  private orphans = new Map<string, Block[]>() // keyed by missing parent hash
  private main: string[] = [] // main-chain hashes by height
  tip: ChainNode

  constructor(readonly genesis: GenesisConfig, readonly opts: ApplyOptions = {}) {
    super()
    const block = genesisBlock(genesis)
    const g: ChainNode = { hash: bytesToHex(headerHash(block.header)), block, state: genesisState(genesis), receivedAt: genesis.timestamp }
    this.genesisHash = g.hash
    this.nodes.set(g.hash, g)
    this.main = [g.hash]
    this.tip = g
  }

  get height(): number {
    return this.tip.state.height
  }

  has(hash: string): boolean {
    return this.nodes.has(hash)
  }

  get(hash: string): ChainNode | undefined {
    return this.nodes.get(hash)
  }

  atHeight(height: number): ChainNode | undefined {
    const h = this.main[height]
    return h ? this.nodes.get(h) : undefined
  }

  isMain(hash: string): boolean {
    const n = this.nodes.get(hash)
    return !!n && this.main[n.state.height] === hash
  }

  /** Main-chain nodes in [from, to], inclusive. */
  range(from: number, to: number): ChainNode[] {
    const out: ChainNode[] = []
    for (let h = Math.max(0, from); h <= Math.min(to, this.height); h++) out.push(this.nodes.get(this.main[h])!)
    return out
  }

  /** All known blocks, including side branches (for the projector's fork tree). */
  allNodes(): ChainNode[] {
    return [...this.nodes.values()]
  }

  /**
   * Validates and inserts a block. Throws ValidationError if invalid. Blocks whose
   * parent is unknown are parked as orphans and connected when the parent arrives.
   */
  addBlock(block: Block, now?: number): AddResult {
    const hash = bytesToHex(headerHash(block.header))
    if (this.nodes.has(hash)) return { status: 'duplicate', hash }
    const parentHash = bytesToHex(block.header.prevHash)
    const parent = this.nodes.get(parentHash)
    if (!parent) {
      this.parkOrphan(parentHash, block)
      return { status: 'orphan', hash, missingParent: parentHash }
    }
    const state = applyBlock(parent.state, block, { ...this.opts, now })
    const node: ChainNode = { hash, block, state, receivedAt: Date.now() }
    this.nodes.set(hash, node)
    // Decide the tip first, so listeners see whether this block is on the main chain.
    if (state.totalWork > this.tip.state.totalWork) this.switchTip(node)
    this.emit('block', node)
    this.connectOrphans(hash, now)
    return { status: 'added', hash, main: this.isMain(hash) }
  }

  private parkOrphan(parentHash: string, block: Block): void {
    const total = [...this.orphans.values()].reduce((n, l) => n + l.length, 0)
    if (total >= MAX_ORPHANS) this.orphans.delete(this.orphans.keys().next().value!)
    const list = this.orphans.get(parentHash) ?? []
    list.push(block)
    this.orphans.set(parentHash, list)
  }

  private connectOrphans(parentHash: string, now?: number): void {
    const waiting = this.orphans.get(parentHash)
    if (!waiting) return
    this.orphans.delete(parentHash)
    for (const b of waiting) {
      try {
        this.addBlock(b, now)
      } catch {
        // invalid orphan: drop it
      }
    }
  }

  private switchTip(newTip: ChainNode): void {
    const added: ChainNode[] = []
    let n: ChainNode | undefined = newTip
    while (n && this.main[n.state.height] !== n.hash) {
      added.unshift(n)
      n = this.nodes.get(bytesToHex(n.block.header.prevHash))
    }
    const forkHeight = n ? n.state.height : 0
    const removed: ChainNode[] = []
    for (let h = this.height; h > forkHeight; h--) removed.push(this.nodes.get(this.main[h])!)
    this.main.length = forkHeight + 1
    for (const a of added) this.main.push(a.hash)
    this.tip = newTip
    const change: TipChange = { tip: newTip, removed, added }
    this.emit('tip', change)
  }
}
