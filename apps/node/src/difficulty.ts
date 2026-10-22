import { type Address, type KeyPair, MAX_TARGET, PARAMS, SHARE_WORK, signTicket } from '@isfcr/core'

const WINDOW_MS = 60_000
const MIN_WINDOW_MS = 15_000 // don't let one lucky early share set a miner's hashrate
/** Assumed hashrate for a miner we have no shares from yet (a slow phone). */
const DEFAULT_HASHRATE = 50_000

export interface DifficultyRow {
  address: Address
  hashrate: number
  work: number
  target: string
}

/** Per-block bounds on the network correction, like Global PoW's ×0.5–×2 retarget clamp. */
const MAX_STEP = 2
const SCALE_MIN = 1 / 64
const SCALE_MAX = 1 << 20

/**
 * Dynamic PoW bookkeeping on the host. Miners prove hashrate with shares; the
 * host gives each miner a target so that expected block time per miner is
 * N × 15 s (N = active miners). The whole network then averages ~15 s per block.
 * Exploitable on purpose: shares are self-reported (sandbagging) and N counts
 * addresses, not people (address splitting).
 *
 * Hashrate estimates can be wrong (too few shares, a laptop waking from sleep,
 * sandbagging), so a network-wide `scale` multiplies every miner's work and is
 * retargeted from actual block times, the same feedback loop Global PoW uses.
 */
export class DifficultyService {
  private shares = new Map<Address, number[]>() // share timestamps per miner
  private firstSeen = new Map<Address, number>()
  /** Network correction on top of the per-miner estimate (1 = trust estimates as-is). */
  scale = 1

  private recentDt: number[] = []

  /**
   * Called for each new Dynamic PoW block with the time since its parent. Uses the
   * mean of the last few block times: block times are exponentially distributed, and
   * correcting on each one individually ratchets difficulty upward (E[log] bias).
   */
  onBlock(dtMs: number): void {
    this.recentDt.push(Math.max(dtMs, 0))
    if (this.recentDt.length > PARAMS.RETARGET_WINDOW) this.recentDt.shift()
    const mean = this.recentDt.reduce((a, b) => a + b, 0) / this.recentDt.length
    const ratio = PARAMS.TARGET_BLOCK_MS / Math.max(mean, 1)
    // Move a quarter of the way (in log terms) toward the ideal, at most ×2 per block.
    const step = Math.min(MAX_STEP, Math.max(1 / MAX_STEP, Math.pow(ratio, 0.25)))
    this.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, this.scale * step))
  }

  record(address: Address, count: number, now = Date.now()): void {
    if (!this.firstSeen.has(address)) this.firstSeen.set(address, now)
    const list = this.shares.get(address) ?? []
    for (let i = 0; i < count; i++) list.push(now)
    this.shares.set(address, list)
    this.prune(now)
  }

  private prune(now: number): void {
    for (const [addr, list] of this.shares) {
      const kept = list.filter((t) => now - t < WINDOW_MS)
      if (kept.length) this.shares.set(addr, kept)
      else {
        this.shares.delete(addr)
        this.firstSeen.delete(addr)
      }
    }
  }

  hashrate(address: Address, now = Date.now()): number {
    const list = this.shares.get(address)
    if (!list?.length) return 0
    const span = Math.min(WINDOW_MS, Math.max(MIN_WINDOW_MS, now - this.firstSeen.get(address)!))
    return (list.length * Number(SHARE_WORK)) / (span / 1000)
  }

  activeMiners(now = Date.now()): Address[] {
    this.prune(now)
    return [...this.shares.keys()]
  }

  /** Expected hashes this miner must do per block for equal odds. */
  workFor(address: Address, now = Date.now()): number {
    const active = new Set(this.activeMiners(now))
    active.add(address)
    const h = this.hashrate(address, now) || DEFAULT_HASHRATE
    return Math.max(1, h * active.size * (PARAMS.TARGET_BLOCK_MS / 1000) * this.scale)
  }

  targetFor(address: Address, now = Date.now()): bigint {
    const t = MAX_TARGET / BigInt(Math.round(this.workFor(address, now)))
    return t < 1n ? 1n : t
  }

  ticket(chainId: string, height: number, address: Address, host: KeyPair): { target: bigint; proof: Uint8Array } {
    const target = this.targetFor(address)
    return { target, proof: signTicket(chainId, height, address, target, host.privateKey, host.publicKey) }
  }

  table(now = Date.now()): DifficultyRow[] {
    return this.activeMiners(now)
      .map((address) => ({ address, hashrate: Math.round(this.hashrate(address, now)), work: Math.round(this.workFor(address, now)), target: this.targetFor(address, now).toString(16) }))
      .sort((a, b) => b.hashrate - a.hashrate)
  }

  clear(): void {
    this.shares.clear()
    this.firstSeen.clear()
    this.scale = 1
    this.recentDt = []
  }
}
