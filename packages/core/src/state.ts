import { type Block, type BlockHeader, BLOCK_VERSION, decodeHeader, headerHash, computeMerkleRoot } from './block'
import { equalBytes, bytesToHex } from './bytes'
import { getConsensus, ValidationError, workForTarget, MAX_TARGET, posSignatureValid, sameProposerConflict, vrfTiebreak } from './consensus'
import { ZERO_HASH, type Hash } from './hash'
import type { Address } from './keys'
import { ConsensusMode, PARAMS, blockReward } from './params'
import { type CoinbaseTx, type SignedTx, TxType, isCoinbase, txId, txSender, verifyTxSignature } from './tx'

export interface Account {
  balance: bigint
  nonce: number
  stake: bigint
}

export interface Proposal {
  id: string
  proposer: Address
  mode: ConsensusMode
  activateAt: number
  votesFor: Set<Address>
  votesAgainst: Set<Address>
  passed: boolean
}

export interface GenesisConfig {
  chainId: string
  timestamp: number
  faucetAddress: Address
  faucetAllocation: bigint
  instructorAddress: Address
  /** Coins for the instructor key to pay governance fees. Defaults to 0. */
  instructorAllocation?: bigint
  initialMode: ConsensusMode
  initialTarget: bigint
}

export interface ChainState {
  genesis: GenesisConfig
  height: number
  tipHash: Hash
  /** Cumulative fork-choice weight up to and including the tip. */
  totalWork: bigint
  accounts: Map<Address, Account>
  mode: ConsensusMode
  /** Network PoW target (global difficulty; also the base for Dynamic PoW). */
  target: bigint
  emitted: bigint
  recentTimestamps: number[]
  proposals: Map<string, Proposal>
  scheduledSwitch: { mode: ConsensusMode; activateAt: number; proposalId: string } | null
  /** `${height}:${proposer}` equivocations already punished, so evidence can't be reused. */
  slashed: Set<string>
}

export interface ApplyOptions {
  /** Current wall-clock time; when given, blocks too far in the future are rejected. */
  now?: number
  /** Fork demo: a node on "old rules" ignores governance-scheduled mode switches. */
  ignoreGovernance?: boolean
}

export function genesisBlock(g: GenesisConfig): Block {
  return {
    header: {
      version: BLOCK_VERSION,
      height: 0,
      prevHash: ZERO_HASH,
      merkleRoot: ZERO_HASH,
      timestamp: g.timestamp,
      mode: g.initialMode,
      proposer: g.faucetAddress,
      target: g.initialTarget,
      nonce: 0n,
      proof: new TextEncoder().encode(g.chainId),
    },
    txs: [],
  }
}

export function genesisState(g: GenesisConfig): ChainState {
  const instructorAlloc = g.instructorAllocation ?? 0n
  if (g.faucetAllocation + instructorAlloc > PARAMS.SUPPLY_CAP) throw new Error('genesis allocation exceeds supply cap')
  const accounts = new Map<Address, Account>()
  accounts.set(g.faucetAddress, { balance: g.faucetAllocation, nonce: 0, stake: 0n })
  if (instructorAlloc > 0n) accounts.set(g.instructorAddress, { balance: instructorAlloc, nonce: 0, stake: 0n })
  return {
    genesis: g,
    height: 0,
    tipHash: headerHash(genesisBlock(g).header),
    totalWork: 0n,
    accounts,
    mode: g.initialMode,
    target: g.initialTarget,
    emitted: g.faucetAllocation + instructorAlloc,
    recentTimestamps: [g.timestamp],
    proposals: new Map(),
    scheduledSwitch: null,
    slashed: new Set(),
  }
}

export function cloneState(s: ChainState): ChainState {
  const accounts = new Map<Address, Account>()
  for (const [k, v] of s.accounts) accounts.set(k, { ...v })
  const proposals = new Map<string, Proposal>()
  for (const [k, p] of s.proposals) {
    proposals.set(k, { ...p, votesFor: new Set(p.votesFor), votesAgainst: new Set(p.votesAgainst) })
  }
  return {
    ...s,
    accounts,
    proposals,
    recentTimestamps: [...s.recentTimestamps],
    slashed: new Set(s.slashed),
    scheduledSwitch: s.scheduledSwitch ? { ...s.scheduledSwitch } : null,
  }
}

export function getAccount(s: ChainState, addr: Address): Account {
  return s.accounts.get(addr) ?? { balance: 0n, nonce: 0, stake: 0n }
}

function account(s: ChainState, addr: Address): Account {
  let a = s.accounts.get(addr)
  if (!a) {
    a = { balance: 0n, nonce: 0, stake: 0n }
    s.accounts.set(addr, a)
  }
  return a
}

/** The consensus mode the block at `height` must use on top of state `s`. */
export function expectedMode(s: ChainState, height: number, opts: ApplyOptions = {}): ConsensusMode {
  const sw = s.scheduledSwitch
  if (!opts.ignoreGovernance && sw && height >= sw.activateAt) return sw.mode
  return s.mode
}

/** Reward the coinbase may claim at `height`, clipped so emission never exceeds the cap. */
export function cappedReward(s: ChainState, height: number): bigint {
  const r = blockReward(height)
  const room = PARAMS.SUPPLY_CAP - s.emitted
  return r < room ? r : room
}

/** Votes are weighted by balance + stake. */
export function votingWeight(s: ChainState, voters: Iterable<Address>): bigint {
  let w = 0n
  for (const v of voters) {
    const a = getAccount(s, v)
    w += a.balance + a.stake
  }
  return w
}

/** Coins that can vote: everything except the host's faucet and instructor accounts. */
export function circulatingSupply(s: ChainState): bigint {
  let total = 0n
  for (const [addr, a] of s.accounts) {
    if (addr !== s.genesis.faucetAddress && addr !== s.genesis.instructorAddress) total += a.balance + a.stake
  }
  return total
}

function maybePass(s: ChainState, p: Proposal, height: number): void {
  if (p.passed || height >= p.activateAt) return
  const support = votingWeight(s, p.votesFor)
  const total = circulatingSupply(s)
  if (total > 0n && support * 2n >= total) markPassed(s, p)
}

function markPassed(s: ChainState, p: Proposal): void {
  p.passed = true
  s.scheduledSwitch = { mode: p.mode, activateAt: p.activateAt, proposalId: p.id }
}

/** Validates a signed tx against state and applies it in place. Returns its fee. */
export function applyTx(s: ChainState, tx: SignedTx, height: number): bigint {
  if (tx.chainId !== s.genesis.chainId) throw new ValidationError('wrong chainId')
  if (!verifyTxSignature(tx)) throw new ValidationError('bad signature')
  if (tx.fee < PARAMS.MIN_FEE) throw new ValidationError('fee below minimum')
  const from = txSender(tx)
  const acc = account(s, from)
  if (tx.nonce !== acc.nonce) throw new ValidationError(`bad nonce: expected ${acc.nonce}, got ${tx.nonce}`)

  const spend = (amount: bigint) => {
    if (amount <= 0n) throw new ValidationError('amount must be positive')
    if (acc.balance < amount + tx.fee) throw new ValidationError('insufficient balance')
    acc.balance -= amount
  }

  const b = tx.body
  switch (b.type) {
    case TxType.Transfer:
      spend(b.amount)
      account(s, b.to).balance += b.amount
      break
    case TxType.Stake:
      spend(b.amount)
      acc.stake += b.amount
      break
    case TxType.Unstake:
      if (b.amount <= 0n || acc.stake < b.amount) throw new ValidationError('insufficient stake')
      acc.stake -= b.amount
      acc.balance += b.amount
      break
    case TxType.ProposeConsensus: {
      if (b.activateAt <= height) throw new ValidationError('activateAt must be in the future')
      if (!(b.mode in ConsensusMode)) throw new ValidationError('unknown consensus mode')
      const id = txId(tx)
      const p: Proposal = {
        id, proposer: from, mode: b.mode, activateAt: b.activateAt,
        votesFor: new Set([from]), votesAgainst: new Set(), passed: false,
      }
      s.proposals.set(id, p)
      if (from === s.genesis.instructorAddress) markPassed(s, p) // instructor-key governance
      else maybePass(s, p, height)
      break
    }
    case TxType.Vote: {
      const p = s.proposals.get(b.proposalId)
      if (!p) throw new ValidationError('unknown proposal')
      if (height >= p.activateAt) throw new ValidationError('voting closed')
      if (p.votesFor.has(from) || p.votesAgainst.has(from)) throw new ValidationError('already voted')
      ;(b.approve ? p.votesFor : p.votesAgainst).add(from)
      maybePass(s, p, height)
      break
    }
    case TxType.Slash: {
      let a: BlockHeader, c: BlockHeader
      try {
        a = decodeHeader(b.headerA)
        c = decodeHeader(b.headerB)
      } catch {
        throw new ValidationError('slash evidence: malformed header')
      }
      if (a.mode !== ConsensusMode.PoS || c.mode !== ConsensusMode.PoS) throw new ValidationError('slash evidence must be PoS blocks')
      if (!sameProposerConflict(a, c)) throw new ValidationError('slash evidence: not two different blocks from one proposer at one height')
      if (!posSignatureValid(a) || !posSignatureValid(c)) throw new ValidationError('slash evidence: signatures do not check out')
      const key = `${a.height}:${a.proposer}`
      if (s.slashed.has(key)) throw new ValidationError('already slashed for this equivocation')
      s.slashed.add(key)
      // Half the offender's stake is burned; the reporter earns a tenth of what was burned.
      const offender = account(s, a.proposer)
      const burned = offender.stake / 2n
      offender.stake -= burned
      acc.balance += burned / 10n
      break
    }
    default:
      throw new ValidationError('unknown tx type')
  }

  if (acc.balance < tx.fee) throw new ValidationError('insufficient balance for fee')
  acc.balance -= tx.fee
  acc.nonce += 1
  return tx.fee
}

/** Global-PoW retarget: damped adjustment toward TARGET_BLOCK_MS over a sliding window. */
function retarget(s: ChainState): void {
  const ts = s.recentTimestamps
  if (ts.length < 2) return
  const n = BigInt(ts.length - 1)
  const actual = BigInt(Math.max(1, ts[ts.length - 1] - ts[0]))
  const expected = n * BigInt(PARAMS.TARGET_BLOCK_MS)
  // Move a quarter of the way toward the ideal each block to avoid oscillation.
  let next = (s.target * (actual + 3n * expected)) / (4n * expected)
  if (next > s.target * 2n) next = s.target * 2n
  if (next < s.target / 2n) next = s.target / 2n
  if (next > MAX_TARGET) next = MAX_TARGET
  if (next < 1n) next = 1n
  s.target = next
}

export function blockWork(header: BlockHeader, parent: ChainState): bigint {
  // Global PoW blocks weigh their target's work. Every other mode (including Dynamic PoW,
  // whose per-miner targets deliberately differ) weighs the network target's work, so a
  // slow miner's block counts as much as a fast one's and fork choice stays comparable.
  if (header.mode === ConsensusMode.GlobalPoW && header.target > 0n) return workForTarget(header.target)
  const base = workForTarget(parent.target)
  return header.mode === ConsensusMode.VRFLottery ? base + vrfTiebreak(header, base) : base
}

/**
 * Full block validation. Returns the new state; the input state is never mutated,
 * so callers can keep per-block snapshots for reorgs.
 */
export function applyBlock(parent: ChainState, block: Block, opts: ApplyOptions = {}): ChainState {
  const h = block.header
  const hash = headerHash(h)
  if (h.version !== BLOCK_VERSION) throw new ValidationError('unsupported block version')
  if (h.height !== parent.height + 1) throw new ValidationError(`bad height: expected ${parent.height + 1}`)
  if (!equalBytes(h.prevHash, parent.tipHash)) throw new ValidationError('prevHash does not match tip')
  const parentTs = parent.recentTimestamps[parent.recentTimestamps.length - 1]
  if (h.timestamp < parentTs) throw new ValidationError('timestamp before parent')
  if (opts.now !== undefined && h.timestamp > opts.now + PARAMS.MAX_FUTURE_DRIFT_MS) {
    throw new ValidationError('timestamp too far in the future')
  }
  const mode = expectedMode(parent, h.height, opts)
  if (h.mode !== mode) throw new ValidationError(`wrong consensus mode: expected ${ConsensusMode[mode]}`)
  if (block.txs.length === 0 || !isCoinbase(block.txs[0])) throw new ValidationError('first tx must be coinbase')
  if (block.txs.length - 1 > PARAMS.MAX_TXS_PER_BLOCK) throw new ValidationError('too many transactions')
  if (!equalBytes(h.merkleRoot, computeMerkleRoot(block.txs))) throw new ValidationError('bad merkle root')

  getConsensus(mode).validateProof(h, parent, { hash })

  const s = cloneState(parent)
  if (mode !== s.mode) {
    s.mode = mode
    s.scheduledSwitch = null
  }

  let fees = 0n
  const seen = new Set<string>()
  for (const tx of block.txs.slice(1)) {
    if (isCoinbase(tx)) throw new ValidationError('only one coinbase allowed')
    const id = txId(tx)
    if (seen.has(id)) throw new ValidationError('duplicate transaction')
    seen.add(id)
    fees += applyTx(s, tx, h.height)
  }

  const cb = block.txs[0] as CoinbaseTx
  const reward = cappedReward(parent, h.height)
  if (cb.height !== h.height) throw new ValidationError('coinbase height mismatch')
  if (cb.to !== h.proposer) throw new ValidationError('coinbase must pay the proposer')
  if (cb.amount !== reward + fees) throw new ValidationError(`coinbase amount must be ${reward + fees}`)
  account(s, cb.to).balance += cb.amount
  s.emitted += reward

  s.height = h.height
  s.tipHash = hash
  s.totalWork = parent.totalWork + blockWork(h, parent)
  s.recentTimestamps.push(h.timestamp)
  if (s.recentTimestamps.length > PARAMS.RETARGET_WINDOW + 1) s.recentTimestamps.shift()
  if (mode === ConsensusMode.GlobalPoW) retarget(s)
  return s
}

export function stateSummary(s: ChainState) {
  return {
    height: s.height,
    tip: bytesToHex(s.tipHash),
    mode: s.mode,
    modeName: ConsensusMode[s.mode],
    target: s.target.toString(16),
    emitted: s.emitted.toString(),
    accounts: s.accounts.size,
    scheduledSwitch: s.scheduledSwitch,
  }
}
