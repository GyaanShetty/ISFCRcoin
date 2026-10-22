import { type KeyPair, TxType, UNIT, getAccount, keyPairFromPrivate, sha256, signTx, utf8ToBytes } from '@isfcr/core'
import type { IsfcrNode } from './node'

const BOT_FUNDING = 50n * UNIT
/** Bots stake part of their coins so Proof of Stake always has validators. */
const BOT_STAKE = 20n * UNIT

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/**
 * Bot wallets that keep the mempool busier than one block can hold, with a
 * spread of fees, so fee-priority selection is visible to students.
 */
export class TxGenerator {
  private timer: NodeJS.Timeout | null = null
  private funded = new Set<string>() // `${chainId}:${address}`
  private staked = new Set<string>()

  constructor(private node: IsfcrNode, private botCount: number, private intervalMs: number) {}

  get running(): boolean {
    return this.timer !== null
  }

  bots(): KeyPair[] {
    const chainId = this.node.chain.genesis.chainId
    return Array.from({ length: this.botCount }, (_, i) => keyPairFromPrivate(sha256(utf8ToBytes(`txgen:${chainId}:${i}`))))
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private fundBots(bots: KeyPair[]): void {
    const chainId = this.node.chain.genesis.chainId
    for (const bot of bots) {
      const key = `${chainId}:${bot.address}`
      if (this.funded.has(key)) continue
      try {
        this.node.faucetSend(bot.address, BOT_FUNDING)
        this.funded.add(key)
      } catch {
        // faucet busy or empty; retry next tick
      }
    }
  }

  private stakeBots(bots: KeyPair[]): void {
    const state = this.node.chain.tip.state
    for (const bot of bots) {
      const key = `${state.genesis.chainId}:${bot.address}`
      const acc = getAccount(state, bot.address)
      if (this.staked.has(key) || acc.stake > 0n || acc.balance < BOT_STAKE + UNIT) continue
      try {
        this.node.submitTx(signTx(
          { chainId: state.genesis.chainId, nonce: this.node.mempool.nextNonce(state, bot.address), fee: UNIT / 10n, body: { type: TxType.Stake, amount: BOT_STAKE } },
          bot.privateKey, bot.publicKey))
        this.staked.add(key)
      } catch {
        // retry next tick
      }
    }
  }

  tick(): void {
    const bots = this.bots()
    this.fundBots(bots)
    this.stakeBots(bots)
    const state = this.node.chain.tip.state
    const from = bots[randInt(0, bots.length - 1)]
    let to = bots[randInt(0, bots.length - 1)]
    if (to.address === from.address) to = bots[(bots.indexOf(from) + 1) % bots.length]
    if (getAccount(state, from.address).balance < UNIT) return
    // Mostly cheap fees with a long tail of expensive ones: 0.1 to 2.0 ISFCR.
    const feeTenths = Math.min(20, 1 + Math.floor(-Math.log(1 - Math.random()) * 4))
    const tx = signTx(
      {
        chainId: state.genesis.chainId,
        nonce: this.node.mempool.nextNonce(state, from.address),
        fee: (BigInt(feeTenths) * UNIT) / 10n,
        body: { type: TxType.Transfer, to: to.address, amount: (BigInt(randInt(1, 30)) * UNIT) / 10n },
      },
      from.privateKey,
      from.publicKey,
    )
    try {
      this.node.submitTx(tx)
    } catch {
      // out of balance with pending txs, or per-sender cap reached; skip
    }
  }
}
