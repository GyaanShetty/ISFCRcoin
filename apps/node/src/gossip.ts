import { blockFromJSON, txFromJSON, type SignedTx } from '@isfcr/core'
import type { IsfcrNode } from './node'

/**
 * Connection to another seed node. Subscribes to its WebSocket feed, relays
 * blocks and txs into our node, and backfills missing ancestors over HTTP.
 * Our own feed relays back to it, and duplicates are ignored, so no loops.
 */
export class Peer {
  private ws: WebSocket | null = null
  private closed = false
  connected = false

  constructor(private node: IsfcrNode, readonly baseUrl: string) {}

  connect(): void {
    if (this.closed) return
    const ws = new WebSocket(this.baseUrl.replace(/^http/, 'ws') + '/ws?peer=1')
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.sync().catch((e) => console.warn(`[peer ${this.baseUrl}] sync failed: ${e.message}`))
    }
    ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data))).catch(() => {})
    ws.onclose = () => {
      this.connected = false
      if (!this.closed) setTimeout(() => this.connect(), 3000)
    }
    ws.onerror = () => ws.close()
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(this.baseUrl + path)
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    return res.json()
  }

  private async handle(msg: any): Promise<void> {
    switch (msg.type) {
      case 'block': {
        if (this.node.chain.has(msg.block.hash)) return
        const r = this.node.submitBlock(blockFromJSON(msg.block))
        if (r.status === 'orphan') await this.backfill(r.missingParent)
        break
      }
      case 'tx':
        try {
          this.node.submitTx(txFromJSON(msg.tx) as SignedTx)
        } catch {
          // already known or invalid on our tip
        }
        break
      case 'reset':
        if (this.node.config.followPeer) this.node.adoptGenesisJSON(await this.get('/api/genesis'))
        break
    }
  }

  async sync(): Promise<void> {
    const info = await this.get('/api/info')
    if (info.genesisHash !== this.node.chain.genesisHash) {
      if (!this.node.config.followPeer) {
        console.warn(`[peer ${this.baseUrl}] different genesis; not following (set FOLLOW_PEER=1 to adopt it)`)
        return
      }
      this.node.adoptGenesisJSON(await this.get('/api/genesis'))
    }
    await this.backfill(info.tip)
  }

  /** Walks back from `hash` until reaching a known block, then applies the blocks oldest-first. */
  private async backfill(hash: string): Promise<void> {
    const stack: any[] = []
    while (!this.node.chain.has(hash) && stack.length < 10_000) {
      const b = await this.get(`/api/block/${hash}`)
      stack.push(b)
      hash = b.header.prevHash
    }
    for (const b of stack.reverse()) {
      try {
        this.node.submitBlock(blockFromJSON(b))
      } catch (e) {
        console.warn(`[peer ${this.baseUrl}] rejected block ${b.hash}: ${(e as Error).message}`)
        return
      }
    }
  }
}
