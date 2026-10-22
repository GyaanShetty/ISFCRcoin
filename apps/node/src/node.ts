import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import {
  type Address, type Block, type BlockHeader, type ConsensusMode, type GenesisConfig, type SignedTx,
  ConsensusMode as Mode, SHARE_TARGET, TxType, UNIT, ValidationError, blockFromJSON, blockToJSON,
  buildBlockTemplate, bytesToHex, cappedReward, expectedMode, getAccount, hashMeetsTarget, headerHash,
  signTx, txFromJSON, txId, txToJSON,
} from '@isfcr/core'
import { DifficultyService } from './difficulty'
import { PosService } from './pos'
import { LotteryService } from './vrf'
import { RoundService } from './rounds'
import { type AddResult, type ChainNode, ChainStore, type TipChange } from './chain'
import type { NodeConfig } from './config'
import { Mempool } from './mempool'
import { Store, genesisFromJSON } from './store'
import { TxGenerator } from './txgen'

const FAUCET_ALLOCATION = 200_000n * UNIT
const INSTRUCTOR_ALLOCATION = 1_000n * UNIT
const FAUCET_FEE = UNIT // faucet payouts outbid the default fee so newcomers get coins quickly
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface LeaderboardRow {
  address: Address
  blocks: number
  rewards: string
}

/**
 * One seed node: chain + mempool + persistence + host services (faucet, join
 * codes, governance shortcuts). Emits 'block', 'tip', 'tx' and 'reset' for the
 * API layer to broadcast.
 */
export class IsfcrNode extends EventEmitter {
  chain!: ChainStore
  readonly mempool: Mempool
  readonly store: Store
  readonly txgen: TxGenerator
  readonly difficulty = new DifficultyService()
  readonly pos: PosService
  readonly lottery: LotteryService
  readonly rounds: RoundService
  private seenShares = new Set<string>()
  private replaying = false

  constructor(readonly config: NodeConfig) {
    super()
    this.store = new Store(config.dbPath)
    this.mempool = new Mempool(new Set([config.faucet.address]))
    this.txgen = new TxGenerator(this, config.txgen.bots, config.txgen.intervalMs)
    const bots = () => (this.txgen.running ? this.txgen.bots() : [])
    this.pos = new PosService(this, bots)
    this.lottery = new LotteryService(this, bots)
    this.rounds = new RoundService(this, bots)
  }

  /** Loads the persisted session (or creates genesis) and replays stored blocks. */
  start(genesis?: GenesisConfig): void {
    let g = genesis ?? this.store.getGenesis()
    if (!g) {
      g = this.newGenesis(1)
      this.store.setGenesis(g)
    }
    this.initChain(g)
    this.replaying = true
    for (const row of this.store.loadBlocks()) {
      try {
        this.chain.addBlock(blockFromJSON(JSON.parse(row.json)))
      } catch (e) {
        console.warn(`skipping stored block ${row.hash}: ${(e as Error).message}`)
      }
    }
    this.replaying = false
    this.restoreMempool()
    if (this.config.txgen.enabled) this.txgen.start()
    this.pos.start()
    this.lottery.start()
    this.rounds.start()
  }

  /** Re-admits txs that were pending when the node last stopped (stale ones are dropped). */
  private restoreMempool(): void {
    let restored = 0
    for (const json of this.store.loadMempool()) {
      try {
        this.mempool.add(txFromJSON(JSON.parse(json)) as SignedTx, this.chain.tip.state)
        restored++
      } catch {
        // mined already, or no longer valid
      }
    }
    this.persistMempool()
    if (restored) console.log(`restored ${restored} pending transaction(s)`)
  }

  private persistMempool(): void {
    this.store.replaceMempool(this.mempool.list().map((e) => ({ id: e.id, json: JSON.stringify(txToJSON(e.tx)) })))
  }

  private newGenesis(session: number): GenesisConfig {
    return {
      chainId: `${this.config.chainName}-s${session}-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      faucetAddress: this.config.faucet.address,
      faucetAllocation: FAUCET_ALLOCATION,
      instructorAddress: this.config.instructor.address,
      instructorAllocation: INSTRUCTOR_ALLOCATION,
      initialMode: Mode.GlobalPoW,
      initialTarget: this.config.initialTarget,
    }
  }

  private initChain(g: GenesisConfig): void {
    this.chain?.removeAllListeners()
    this.chain = new ChainStore(g, { ignoreGovernance: this.config.oldRules })
    this.chain.on('block', (n: ChainNode) => {
      if (!this.replaying) this.store.saveBlock(n.hash, n.state.height, JSON.stringify(blockToJSON(n.block)))
      if (!this.replaying) this.pos.onBlock(n)
      this.emit('block', n)
    })
    this.chain.on('tip', (change: TipChange) => this.onTip(change))
  }

  private onTip({ tip, removed, added }: TipChange): void {
    // Feed actual Dynamic PoW block times back into the difficulty correction.
    for (const n of added) {
      const parent = this.chain.get(bytesToHex(n.block.header.prevHash))
      if (n.block.header.mode === Mode.DynamicPoW && parent) this.difficulty.onBlock(n.block.header.timestamp - parent.block.header.timestamp)
    }
    // Txs from abandoned blocks go back into the pool (oldest first); prune drops anything now mined or invalid.
    for (const n of [...removed].reverse()) {
      for (const tx of n.block.txs.slice(1) as SignedTx[]) {
        try {
          this.mempool.add(tx, tip.state)
        } catch {
          // already on the new branch, or no longer valid
        }
      }
    }
    this.mempool.prune(tip.state)
    if (!this.replaying) {
      this.persistMempool()
      this.pos.onTip(tip)
      this.lottery.onTip(tip)
      this.rounds.onTip(tip)
      this.emit('tip', { tip, reorgDepth: removed.length })
    }
  }

  submitTx(tx: SignedTx): { id: string; isNew: boolean } {
    const id = txId(tx)
    if (this.mempool.has(id)) return { id, isNew: false }
    this.mempool.add(tx, this.chain.tip.state)
    if (!this.replaying) this.store.saveMempoolTx(id, JSON.stringify(txToJSON(tx)))
    this.emit('tx', tx, id)
    return { id, isNew: true }
  }

  submitBlock(block: Block): AddResult {
    return this.chain.addBlock(block, Date.now())
  }

  /** Unsealed block on the current tip; `txIds` restricts selection to the miner's own picks. */
  template(proposer: Address, txIds?: string[], now = Date.now()): { block: Block; reward: bigint; fees: bigint } {
    const state = this.chain.tip.state
    const txs = this.mempool.select(state, undefined, txIds ? new Set(txIds) : undefined)
    const block = buildBlockTemplate(state, proposer, txs, now, { ignoreGovernance: this.config.oldRules })
    if (block.header.mode === Mode.PoS) block.header.proof = this.pos.templateProof(this.chain.tip.hash)
    if (block.header.mode === Mode.DynamicPoW) {
      const t = this.difficulty.ticket(state.genesis.chainId, block.header.height, proposer, this.config.instructor)
      block.header.target = t.target
      block.header.proof = t.proof
    }
    const reward = cappedReward(state, state.height + 1)
    return { block, reward, fees: txs.reduce((s, t) => s + t.fee, 0n) }
  }

  private signedBy(key: NodeConfig['faucet'], body: SignedTx['body'], fee: bigint): SignedTx {
    const state = this.chain.tip.state
    return signTx(
      { chainId: state.genesis.chainId, nonce: this.mempool.nextNonce(state, key.address), fee, body },
      key.privateKey,
      key.publicKey,
    )
  }

  /**
   * A tx from the host (faucet) key, e.g. slashing evidence the node files itself.
   * It pays a high fee so it isn't starved by fee-paying traffic in full blocks.
   */
  hostSubmit(body: SignedTx['body']): string {
    return this.submitTx(this.signedBy(this.config.faucet, body, 5n * UNIT)).id
  }

  faucetSend(to: Address, amount: bigint): string {
    return this.submitTx(this.signedBy(this.config.faucet, { type: TxType.Transfer, to, amount }, FAUCET_FEE)).id
  }

  /**
   * Shares prove hashrate for Dynamic PoW: hashes of a template header (for one
   * of the last few tips) that meet SHARE_TARGET. Each counts as SHARE_WORK hashes.
   */
  submitShares(header: BlockHeader, nonces: bigint[]): { accepted: number; hashrate: number } {
    const parent = this.chain.get(bytesToHex(header.prevHash))
    if (!parent || this.chain.height - parent.state.height > 2) throw new ValidationError('shares are for a stale tip')
    if (expectedMode(parent.state, header.height, { ignoreGovernance: this.config.oldRules }) !== Mode.DynamicPoW) {
      throw new ValidationError('shares only count in Dynamic PoW mode')
    }
    let accepted = 0
    for (const nonce of nonces.slice(0, 500)) {
      const hash = headerHash({ ...header, nonce })
      const id = bytesToHex(hash)
      if (this.seenShares.has(id) || !hashMeetsTarget(hash, SHARE_TARGET)) continue
      this.seenShares.add(id)
      accepted++
    }
    if (this.seenShares.size > 200_000) this.seenShares.clear()
    this.difficulty.record(header.proposer, accepted)
    return { accepted, hashrate: Math.round(this.difficulty.hashrate(header.proposer)) }
  }

  // ---- identity: join codes and one faucet claim per identity per session ----

  createJoinCodes(count: number): string[] {
    const codes = Array.from({ length: count }, () =>
      Array.from(randomBytes(6), (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join(''))
    this.store.addJoinCodes(codes)
    return codes
  }

  /** Exchanges a join code for a session token. With openJoin, any name works as a code. */
  join(rawCode: string, name?: string): string {
    const code = rawCode.trim().toUpperCase()
    if (!code) throw new ValidationError('join code required')
    let row = this.store.getJoinCode(code)
    if (!row && this.config.openJoin) {
      this.store.addJoinCodes([code])
      row = this.store.getJoinCode(code)
    }
    if (!row) throw new ValidationError('unknown join code')
    if (name?.trim()) this.store.setJoinName(code, name.trim())
    if (row.token) return row.token // rejoining (e.g. another device) keeps the same identity
    const token = randomBytes(16).toString('hex')
    this.store.setJoinToken(code, token)
    return token
  }

  claimFaucet(token: string, address: Address): string {
    if (!this.store.tokenExists(token)) throw new ValidationError('not joined: invalid session token')
    const prior = this.store.getFaucetClaim(token)
    if (prior) {
      // A payout lost before it was mined (e.g. pending during a crash) may be re-sent, once per loss.
      if (this.mempool.has(prior.txid) || this.isOnMainChain(prior.txid)) {
        throw new ValidationError(`faucet already claimed this session (to ${prior.address})`)
      }
      const id = this.faucetSend(prior.address, 100n * UNIT)
      this.store.updateFaucetClaim(token, id)
      return id
    }
    const id = this.faucetSend(address, 100n * UNIT)
    this.store.addFaucetClaim(token, address, id)
    return id
  }

  private isOnMainChain(txid: string): boolean {
    for (const n of this.chain.range(1, this.chain.height)) {
      if (n.block.txs.some((t) => txId(t) === txid)) return true
    }
    return false
  }

  // ---- governance ----

  /** Instructor-key proposal: passes as soon as it is mined, activates `activateIn` blocks later. */
  proposeConsensus(mode: ConsensusMode, activateIn: number): string {
    if (!(mode in Mode)) throw new ValidationError('unknown mode')
    // At least 3 blocks out, so the proposal has time to be mined before it activates.
    const activateAt = this.chain.height + Math.max(3, activateIn)
    // A high fee so the switch isn't queued behind fee-paying traffic in full blocks.
    return this.submitTx(this.signedBy(this.config.instructor, { type: TxType.ProposeConsensus, mode, activateAt }, 5n * UNIT)).id
  }

  // ---- session ----

  leaderboard(): LeaderboardRow[] {
    const rows = new Map<Address, { blocks: number; rewards: bigint }>()
    for (const n of this.chain.range(1, this.chain.height)) {
      const cb = n.block.txs[0] as { to: Address; amount: bigint }
      const r = rows.get(cb.to) ?? { blocks: 0, rewards: 0n }
      r.blocks++
      r.rewards += cb.amount
      rows.set(cb.to, r)
    }
    return [...rows.entries()]
      .map(([address, r]) => ({ address, blocks: r.blocks, rewards: r.rewards.toString() }))
      .sort((a, b) => b.blocks - a.blocks)
  }

  /** Archives the leaderboard and starts a fresh chain. `genesis` is given when following a peer. */
  reset(genesis?: GenesisConfig): GenesisConfig {
    const old = this.chain.genesis
    this.store.endSession(old.chainId, this.chain.height, this.leaderboard())
    const session = this.store.listSessions().length + 1
    const g = genesis ?? this.newGenesis(session)
    this.store.setGenesis(g)
    this.mempool.clear()
    this.difficulty.clear()
    this.pos.clear()
    this.lottery.clear()
    this.rounds.clear()
    this.seenShares.clear()
    this.initChain(g)
    this.emit('reset', g)
    return g
  }

  adoptGenesisJSON(j: unknown): void {
    const g = genesisFromJSON(j)
    if (g.chainId !== this.chain.genesis.chainId) this.reset(g)
  }

  balanceOf(addr: Address) {
    const state = this.chain.tip.state
    const a = getAccount(state, addr)
    return { address: addr, balance: a.balance.toString(), stake: a.stake.toString(), nonce: a.nonce, nextNonce: this.mempool.nextNonce(state, addr) }
  }

  close(): void {
    this.txgen.stop()
    this.pos.stop()
    this.lottery.stop()
    this.rounds.stop()
    this.store.close()
  }
}
