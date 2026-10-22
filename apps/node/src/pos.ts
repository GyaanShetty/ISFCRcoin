import {
  type Address, type Attestation, type Block, type KeyPair, ConsensusMode, ValidationError, addressFromPublicKey,
  attestationBytes, encodeHeader, encodePosProof, expectedMode, hexToBytes,
  posLeader, posRound, posSigningBytes, roundOpensAt, sealPosHeader, signAttestation, stakers, totalStake, verify,
  equalBytes, TxType,
} from '@isfcr/core'
import type { ChainNode } from './chain'
import type { IsfcrNode } from './node'

export interface PosStatus {
  active: boolean
  height: number
  round: number
  leader: Address | null
  opensAt: number
  nextRoundAt: number
  totalStake: string
  stakers: { address: Address; stake: string; chance: number }[]
  attestations: number
}

/**
 * Host-side Proof of Stake helpers: slot status for clients, attestation pool,
 * bot validators (so the chain keeps moving when students are idle), and an
 * equivocation watcher that files slashing evidence automatically.
 */
export class PosService {
  private atts = new Map<string, Map<Address, Attestation>>() // block hash → attester → attestation
  private proposed = new Set<string>() // `${height}:${round}` the bots already proposed
  private signedAt = new Map<string, Block>() // `${height}:${proposer}` → first block seen
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
    this.atts.clear()
    this.proposed.clear()
    this.signedAt.clear()
  }

  private nextIsPos(): boolean {
    const tip = this.node.chain.tip.state
    return expectedMode(tip, tip.height + 1, { ignoreGovernance: this.node.config.oldRules }) === ConsensusMode.PoS
  }

  status(now = Date.now()): PosStatus {
    const tip = this.node.chain.tip
    const s = tip.state
    const parentTs = s.recentTimestamps[s.recentTimestamps.length - 1]
    const round = Math.max(0, posRound(parentTs, now))
    const total = totalStake(s)
    return {
      active: this.nextIsPos(),
      height: s.height + 1,
      round,
      leader: posLeader(s, round),
      opensAt: roundOpensAt(parentTs, round),
      nextRoundAt: roundOpensAt(parentTs, round + 1),
      totalStake: total.toString(),
      stakers: stakers(s).map((x) => ({ address: x.address, stake: x.stake.toString(), chance: total ? Number((x.stake * 10_000n) / total) / 10_000 : 0 }))
        .sort((a, b) => b.chance - a.chance),
      attestations: this.atts.get(tip.hash)?.size ?? 0,
    }
  }

  /** Records a staker's signature over `blockHash`; bundled into the next block. */
  attest(blockHash: string, publicKey: Uint8Array, signature: Uint8Array): number {
    const n = this.node.chain.get(blockHash)
    if (!n) throw new ValidationError('unknown block')
    const who = addressFromPublicKey(publicKey)
    // Attesters must have had stake when the block they vouch for was the parent.
    if ((n.state.accounts.get(who)?.stake ?? 0n) === 0n) throw new ValidationError('only stakers can attest')
    if (!verify(signature, attestationBytes(n.state.genesis.chainId, hexToBytes(blockHash)), publicKey)) {
      throw new ValidationError('bad attestation signature')
    }
    const pool = this.atts.get(blockHash) ?? new Map()
    pool.set(who, { publicKey, signature })
    this.atts.set(blockHash, pool)
    return pool.size
  }

  /** Placeholder proof carrying the pooled attestations; the proposer signs over the rest. */
  templateProof(prevHash: string): Uint8Array {
    const atts = [...(this.atts.get(prevHash)?.values() ?? [])]
    return encodePosProof(new Uint8Array(32), new Uint8Array(64), atts)
  }

  /** Called for every new block (any branch). Detects double-signing and files evidence. */
  onBlock(n: ChainNode): void {
    const h = n.block.header
    if (h.mode !== ConsensusMode.PoS) return
    const key = `${h.height}:${h.proposer}`
    const first = this.signedAt.get(key)
    if (!first) {
      this.signedAt.set(key, n.block)
      return
    }
    if (equalBytes(posSigningBytes(first.header), posSigningBytes(h))) return
    try {
      this.node.hostSubmit({ type: TxType.Slash, headerA: encodeHeader(first.header), headerB: encodeHeader(h) })
      this.node.emit('slash', { height: h.height, proposer: h.proposer })
      this.node.activity.log({ at: Date.now(), kind: 'slash', height: h.height, who: h.proposer, text: `Double-signing caught at block ${h.height}: half the stake burned` })
    } catch {
      // already reported, or the offender had no stake left
    }
  }

  /** New tip: bots attest to it. */
  onTip(tip: ChainNode): void {
    if (!this.nextIsPos()) return
    for (const bot of this.bots()) {
      if ((tip.state.accounts.get(bot.address)?.stake ?? 0n) === 0n) continue
      const a = signAttestation(tip.state.genesis.chainId, hexToBytes(tip.hash), bot.privateKey, bot.publicKey)
      try {
        this.attest(tip.hash, a.publicKey, a.signature)
      } catch {
        // not a staker at that block
      }
    }
  }

  /** Bot validators: propose when one of them leads the current round. */
  private tick(now = Date.now()): void {
    if (!this.nextIsPos()) return
    const s = this.node.chain.tip.state
    const parentTs = s.recentTimestamps[s.recentTimestamps.length - 1]
    const round = posRound(parentTs, now)
    if (round < 0) return
    const key = `${s.height + 1}:${round}`
    if (this.proposed.has(key)) return
    const leader = posLeader(s, round)
    const bot = this.bots().find((b) => b.address === leader)
    if (!bot) return
    this.proposed.add(key)
    const block = this.node.template(bot.address, undefined, now).block
    block.header = sealPosHeader(block.header, bot.privateKey, bot.publicKey)
    try {
      this.node.submitBlock(block)
    } catch (e) {
      console.warn(`[pos] bot block rejected: ${(e as Error).message}`)
    }
  }
}

