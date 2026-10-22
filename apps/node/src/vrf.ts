import {
  type Address, type KeyPair, ConsensusMode, ValidationError, addressFromPublicKey, drawTicket,
  expectedMode, hexToBytes, isRegistered, roundOpensAt, sealVrfHeader, ticketValue, verify, vrfMessage,
} from '@isfcr/core'
import type { ChainNode } from './chain'
import type { IsfcrNode } from './node'

const FALLBACK_MS = 6_000

interface Ticket {
  address: Address
  publicKey: Uint8Array
  ticket: Uint8Array
  value: bigint
}

export interface LotteryStatus {
  active: boolean
  height: number
  opensAt: number
  entries: number
  best: { address: Address; value: string } | null
  ranking: { address: Address; value: string }[]
}

/**
 * VRF Lottery on the host: pools tickets for the next block, lets bots enter
 * (and propose when they win), and falls back to the best bot if the winning
 * human doesn't propose within a few seconds of the slot opening.
 */
export class LotteryService {
  private tickets = new Map<string, Map<Address, Ticket>>() // parent hash → entries
  private proposedFor = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(private node: IsfcrNode, private bots: () => KeyPair[]) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  clear(): void {
    this.tickets.clear()
    this.proposedFor.clear()
  }

  private nextIsLottery(): boolean {
    const s = this.node.chain.tip.state
    return expectedMode(s, s.height + 1, { ignoreGovernance: this.node.config.oldRules }) === ConsensusMode.VRFLottery
  }

  private pool(): Ticket[] {
    return [...(this.tickets.get(this.node.chain.tip.hash)?.values() ?? [])].sort((a, b) => (a.value < b.value ? -1 : 1))
  }

  status(): LotteryStatus {
    const s = this.node.chain.tip.state
    const ranked = this.pool()
    const fmt = (t: Ticket) => ({ address: t.address, value: t.value.toString(16).padStart(64, '0') })
    return {
      active: this.nextIsLottery(),
      height: s.height + 1,
      opensAt: roundOpensAt(s.recentTimestamps[s.recentTimestamps.length - 1], 0),
      entries: ranked.length,
      best: ranked[0] ? fmt(ranked[0]) : null,
      ranking: ranked.slice(0, 20).map(fmt),
    }
  }

  /** A ticket for the block after the current tip. Returns the entrant's rank (1 = winning). */
  enter(publicKey: Uint8Array, ticket: Uint8Array): { rank: number; entries: number } {
    const tip = this.node.chain.tip
    const address = addressFromPublicKey(publicKey)
    if (!isRegistered(tip.state, address)) throw new ValidationError('only addresses holding coins can enter')
    if (!verify(ticket, vrfMessage(tip.state.genesis.chainId, hexToBytes(tip.hash), tip.state.height + 1), publicKey)) {
      throw new ValidationError('ticket is not for the current block')
    }
    const pool = this.tickets.get(tip.hash) ?? new Map<Address, Ticket>()
    pool.set(address, { address, publicKey, ticket, value: ticketValue(ticket) })
    this.tickets.set(tip.hash, pool)
    const ranked = this.pool()
    return { rank: ranked.findIndex((t) => t.address === address) + 1, entries: ranked.length }
  }

  /** New tip: registered bots draw their tickets. */
  onTip(tip: ChainNode): void {
    if (this.tickets.size > 50) this.tickets.delete(this.tickets.keys().next().value!)
    this.enterBots(tip)
  }

  /**
   * Bots enter for `tip` unless they already have. Also called every tick, so a node
   * restarted mid-lottery (no new tip yet, no tickets) doesn't deadlock.
   */
  private enterBots(tip: ChainNode): void {
    if (!this.nextIsLottery()) return
    const pool = this.tickets.get(tip.hash)
    for (const bot of this.bots()) {
      if (pool?.has(bot.address)) continue
      if (!isRegistered(tip.state, bot.address)) continue
      try {
        this.enter(bot.publicKey, drawTicket(tip.state.genesis.chainId, hexToBytes(tip.hash), tip.state.height + 1, bot.privateKey))
      } catch {
        // not eligible
      }
    }
  }

  private tick(now = Date.now()): void {
    if (!this.nextIsLottery()) return
    this.enterBots(this.node.chain.tip)
    const st = this.status()
    if (now < st.opensAt || this.proposedFor.has(this.node.chain.tip.hash)) return
    const bots = new Map(this.bots().map((b) => [b.address, b]))
    const ranked = this.pool()
    // The winner proposes; if the winner is a human who hasn't shown up, the best bot covers.
    const winnerIsBot = ranked[0] && bots.has(ranked[0].address)
    const proposer = winnerIsBot ? ranked[0] : now >= st.opensAt + FALLBACK_MS ? ranked.find((t) => bots.has(t.address)) : undefined
    if (!proposer) return
    this.proposedFor.add(this.node.chain.tip.hash)
    const bot = bots.get(proposer.address)!
    const block = this.node.template(bot.address, undefined, now).block
    block.header = sealVrfHeader(block.header, proposer.ticket, bot.privateKey, bot.publicKey)
    try {
      this.node.submitBlock(block)
    } catch (e) {
      console.warn(`[lottery] bot block rejected: ${(e as Error).message}`)
    }
  }
}

